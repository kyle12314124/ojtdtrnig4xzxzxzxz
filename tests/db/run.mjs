/**
 * Database integration tests.
 *
 * Applies the real Supabase migrations to PGlite (embedded PostgreSQL), then
 * exercises constraints, triggers, RPCs, and Row Level Security as the actual
 * `authenticated` role would see them.
 *
 * Run with: npm run test:db
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const migrationsDir = join(root, 'supabase', 'migrations')

const results = []
let db

function pass(name, detail = '') {
  results.push({ name, ok: true, detail })
}

function fail(name, detail) {
  results.push({ name, ok: false, detail })
}

async function check(name, fn) {
  try {
    const detail = await fn()
    pass(name, detail ?? '')
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error))
  }
}

async function expectFailure(name, pattern, fn) {
  try {
    await fn()
    fail(name, 'expected an error but the statement succeeded')
  } catch (error) {
    const message = `${error?.message ?? ''} ${error?.detail ?? ''}`
    if (pattern.test(message)) pass(name)
    else fail(name, `unexpected error: ${message.slice(0, 300)}`)
  }
}

async function query(sql, params) {
  const result = await db.query(sql, params)
  return result.rows
}

async function scalar(sql, params) {
  const rows = await query(sql, params)
  return rows[0] ? Object.values(rows[0])[0] : undefined
}

async function asUser(profileId, fn) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', ${quote(profileId ?? '')}, false);
     set role authenticated;`,
  )
  try {
    return await fn()
  } finally {
    await db.exec('reset role; select set_config(\'request.jwt.claim.sub\', \'\', false);')
  }
}

async function asAnon(fn) {
  await db.exec('set role anon;')
  try {
    return await fn()
  } finally {
    await db.exec('reset role;')
  }
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function insertAuthUser(email, fullName) {
  const rows = await query(
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, jsonb_build_object('full_name', $2::text))
     returning id`,
    [email, fullName],
  )
  return rows[0].id
}

async function main() {
  db = new PGlite()

  const bootstrap = await readFile(join(here, 'bootstrap.sql'), 'utf8')
  await db.exec(bootstrap)

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()
  if (files.length === 0) throw new Error('No migrations found.')
  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    try {
      await db.exec(sql)
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${error.message}`)
    }
  }
  pass(`migrations apply cleanly (${files.length} files)`)

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------
  const adminProfile = await insertAuthUser('admin@ojt.test', 'Admin User')
  await query(`update public.profiles set role = 'admin' where id = $1`, [adminProfile])

  const aliceProfile = await insertAuthUser('alice@ojt.test', 'Alice Santos')
  const bobProfile = await insertAuthUser('bob@ojt.test', 'Bob Reyes')
  const supProfile = await insertAuthUser('sup@ojt.test', 'Supervisor Cruz')
  await query(`update public.profiles set role = 'supervisor' where id = $1`, [supProfile])

  const dept = (
    await query(
      `insert into public.departments (name, code) values ('Information Technology', 'IT')
       returning id`,
    )
  )[0].id

  const schedule = (
    await query(
      `insert into public.work_schedules (name, description, grace_minutes, work_days)
       values ('Standard OJT', 'Mon-Fri 8-12, 1-5', 10, '{1,2,3,4,5}')
       returning id`,
    )
  )[0].id

  await db.exec(`
    insert into public.schedule_periods (schedule_id, label, start_time, end_time, sort_order)
    values
      ('${schedule}', 'Morning', '08:00', '12:00', 1),
      ('${schedule}', 'Afternoon', '13:00', '17:00', 2);
  `)

  const alice = (
    await query(
      `insert into public.employees
         (profile_id, employee_no, first_name, last_name, email, department_id, position,
          employment_type, date_hired, schedule_id)
       values ($1, 'ojt-0001', 'Alice', 'Santos', 'alice@ojt.test', $2, 'OJT Intern',
               'intern', '2026-01-05', $3)
       returning id`,
      [aliceProfile, dept, schedule],
    )
  )[0].id

  const bob = (
    await query(
      `insert into public.employees
         (profile_id, employee_no, first_name, last_name, email, department_id, position,
          employment_type, date_hired, schedule_id)
       values ($1, 'OJT-0002', 'Bob', 'Reyes', 'bob@ojt.test', $2, 'OJT Intern',
               'intern', '2026-01-05', $3)
       returning id`,
      [bobProfile, dept, schedule],
    )
  )[0].id

  const supervisor = (
    await query(
      `insert into public.employees
         (profile_id, employee_no, first_name, last_name, email, department_id, position,
          employment_type, date_hired, schedule_id)
       values ($1, 'OJT-0003', 'Supervisor', 'Cruz', 'sup@ojt.test', $2, 'Team Lead',
               'regular', '2025-06-01', $3)
       returning id`,
      [supProfile, dept, schedule],
    )
  )[0].id

  await query(`update public.employees set supervisor_id = $1 where id = $2`, [
    supervisor,
    alice,
  ])

  const workDate = '2026-11-18'

  await query(
    `insert into public.attendance_records
       (id, employee_id, work_date, schedule_id, first_time_in, last_time_out,
        worked_minutes, late_minutes, undertime_minutes, status)
     values
       ('11111111-1111-1111-1111-111111111111', $1, $2, $3,
        '2026-11-18T00:01:00Z', '2026-11-18T09:02:00Z', 481, 1, 0, 'late')`,
    [alice, workDate, schedule],
  )

  // -------------------------------------------------------------------------
  // Schema behavior
  // -------------------------------------------------------------------------
  await check('auth user triggers an employee-role profile', async () => {
    const profile = (await query(`select * from public.profiles where id = $1`, [aliceProfile]))[0]
    if (!profile) throw new Error('profile missing')
    if (profile.role !== 'employee') throw new Error(`role was ${profile.role}`)
    if (profile.email !== 'alice@ojt.test') throw new Error('email not normalized')
    if (profile.full_name !== 'Alice Santos') throw new Error('full name not copied')
    return 'role=employee, email lowercased'
  })

  await check('employee numbers are normalized to uppercase', async () => {
    const value = await scalar(`select employee_no from public.employees where id = $1`, [alice])
    if (value !== 'OJT-0001') throw new Error(`got ${value}`)
    return value
  })

  await expectFailure(
    'duplicate employee number is rejected',
    /employees_no_key|duplicate key/i,
    async () => {
      const copyProfile = await insertAuthUser('copy@ojt.test', 'Copy Cat')
      await query(
        `insert into public.employees
           (profile_id, employee_no, first_name, last_name, email, department_id, schedule_id)
         values ($1, 'OJT-0001', 'Copy', 'Cat', 'copy@ojt.test', $2, $3)`,
        [copyProfile, dept, schedule],
      )
    },
  )

  await expectFailure(
    'duplicate profile email (case-insensitive) is rejected',
    /profiles_email_key|duplicate key/i,
    () => query(`update public.profiles set email = 'ALICE@OJT.TEST' where id = $1`, [bobProfile]),
  )

  await expectFailure(
    'duplicate attendance day is rejected by the database',
    /attendance_records_employee_day_unique|duplicate key/i,
    () =>
      query(
        `insert into public.attendance_records (employee_id, work_date, schedule_id)
         values ($1, $2, $3)`,
        [alice, workDate, schedule],
      ),
  )

  await check('one open session per employee is enforced', async () => {
    await db.exec(`
      insert into public.attendance_sessions
        (attendance_record_id, employee_id, work_date, session_type, time_in)
      values
        ('11111111-1111-1111-1111-111111111111', '${alice}', '${workDate}',
         'morning', '2026-11-18T08:00:00Z');
    `)
    let blocked = false
    try {
      await db.exec(`
        insert into public.attendance_sessions
          (attendance_record_id, employee_id, work_date, session_type, time_in)
        values
          ('11111111-1111-1111-1111-111111111111', '${alice}', '${workDate}',
           'afternoon', '2026-11-18T13:00:00Z');
      `)
    } catch (error) {
      blocked = /one_open_per_employee|duplicate key|ATTENDANCE_SESSION_OVERLAP/i.test(error.message)
    }
    if (!blocked) throw new Error('second open session was accepted')
    return 'partial unique index blocked the second open punch'
  })

  await check('overlapping closed sessions are rejected by trigger', async () => {
    await db.exec(`
      update public.attendance_sessions
      set time_out = '2026-11-18T12:00:00Z', worked_minutes = 240
      where employee_id = '${alice}' and time_out is null;
    `)
    let blocked = false
    try {
      await db.exec(`
        insert into public.attendance_sessions
          (attendance_record_id, employee_id, work_date, session_type, time_in, time_out)
        values
          ('11111111-1111-1111-1111-111111111111', '${alice}', '${workDate}',
           'morning', '2026-11-18T11:30:00Z', '2026-11-18T13:00:00Z');
      `)
    } catch (error) {
      blocked = /ATTENDANCE_SESSION_OVERLAP/i.test(error.message)
    }
    if (!blocked) throw new Error('overlapping session was accepted')
    return 'overlap trigger raised ATTENDANCE_SESSION_OVERLAP'
  })

  await expectFailure(
    'session work date must match its record',
    /ATTENDANCE_SESSION_MISMATCH|violates foreign key/i,
    () =>
      query(
        `insert into public.attendance_sessions
           (attendance_record_id, employee_id, work_date, session_type, time_in, time_out)
         values ('11111111-1111-1111-1111-111111111111', $1, '2026-11-19', 'custom', $2, $3)`,
        [alice, '2026-11-19T08:00:00Z', '2026-11-19T09:00:00Z'],
      ),
  )

  await expectFailure(
    'overlapping schedule assignments are rejected',
    /SCHEDULE_ASSIGNMENT_OVERLAP/i,
    async () => {
      await query(
        `insert into public.schedule_assignments (employee_id, schedule_id, effective_from, effective_to)
         values ($1, $2, '2026-01-01', '2026-06-30')`,
        [bob, schedule],
      )
      await query(
        `insert into public.schedule_assignments (employee_id, schedule_id, effective_from)
         values ($1, $2, '2026-03-01')`,
        [bob, schedule],
      )
    },
  )

  await expectFailure(
    'overlapping paid periods are rejected',
    /SCHEDULE_PERIOD_OVERLAP/i,
    async () => {
      const other = (
        await query(
          `insert into public.work_schedules (name) values ('Overlap Test') returning id`,
        )
      )[0].id
      await query(
        `insert into public.schedule_periods (schedule_id, label, start_time, end_time)
         values ($1, 'A', '08:00', '12:00')`,
        [other],
      )
      await query(
        `insert into public.schedule_periods (schedule_id, label, start_time, end_time)
         values ($1, 'B', '11:00', '15:00')`,
        [other],
      )
    },
  )

  await expectFailure(
    'overnight shutdown period overlap is detected',
    /SCHEDULE_PERIOD_OVERLAP/i,
    async () => {
      const night = (
        await query(
          `insert into public.work_schedules (name) values ('Night Shift Test') returning id`,
        )
      )[0].id
      await query(
        `insert into public.schedule_periods (schedule_id, label, start_time, end_time)
         values ($1, 'Night', '22:00', '06:00')`,
        [night],
      )
      await query(
        `insert into public.schedule_periods (schedule_id, label, start_time, end_time)
         values ($1, 'Late', '23:00', '01:00')`,
        [night],
      )
    },
  )

  await expectFailure(
    'duplicate pending correction is rejected',
    /attendance_corrections_one_pending|duplicate key/i,
    async () => {
      const insert = () =>
        query(
          `insert into public.attendance_corrections
             (employee_id, attendance_record_id, work_date, correction_type, requested_time_out, reason)
           values ($1, '11111111-1111-1111-1111-111111111111', $2,
                   'missing_time_out', '2026-11-18T09:00:00Z',
                   'I forgot to time out before leaving the office.')`,
          [alice, workDate],
        )
      await insert()
      await insert()
    },
  )

  await expectFailure(
    'audit entries cannot be updated',
    /AUDIT_LOG_IMMUTABLE/i,
    async () => {
      await db.exec(
        `insert into public.audit_logs (action, entity_type) values ('test.action', 'test')`,
      )
      await query(`update public.audit_logs set summary = 'tampered'`)
    },
  )

  await expectFailure(
    'duplicate holiday is rejected',
    /holidays_unique_day_name|duplicate key/i,
    async () => {
      await query(
        `insert into public.holidays (name, holiday_date) values ('Founders Day', '2026-12-01')`,
      )
      await query(
        `insert into public.holidays (name, holiday_date) values ('Founders Day', '2026-12-01')`,
      )
    },
  )

  // -------------------------------------------------------------------------
  // RPC behavior
  // -------------------------------------------------------------------------
  await check('get_my_context returns the caller context', async () => {
    const result = await asUser(aliceProfile, () =>
      query('select public.get_my_context() as ctx'),
    )
    const ctx = result[0].ctx
    if (ctx.profile.email !== 'alice@ojt.test') throw new Error('wrong profile')
    if (ctx.employee.employee_no !== 'OJT-0001') throw new Error('wrong employee')
    if (ctx.employee.schedule.grace_minutes !== 10) throw new Error('schedule not joined')
    if (ctx.employee.schedule.periods.length !== 2) throw new Error('periods not joined')
    return 'profile + employee + schedule + periods'
  })

  await check('health_check works for an active authenticated user', async () => {
    const result = await asUser(bobProfile, () => query('select public.health_check() as h'))
    if (result[0].h.ok !== true) throw new Error('not ok')
    return 'ok=true'
  })

  await expectFailure(
    'anon cannot execute health_check',
    /permission denied/i,
    () => asAnon(() => query('select public.health_check()')),
  )

  // -------------------------------------------------------------------------
  // Row Level Security
  // -------------------------------------------------------------------------
  await check('employee sees only their own employee row', async () => {
    const rows = await asUser(aliceProfile, () => query('select id from public.employees'))
    if (rows.length !== 1) throw new Error(`saw ${rows.length} rows`)
    if (rows[0].id !== alice) throw new Error('saw the wrong employee')
    return '1 row'
  })

  await check('employee sees only their own attendance', async () => {
    const rows = await asUser(aliceProfile, () =>
      query('select employee_id from public.attendance_records'),
    )
    if (rows.length !== 1 || rows[0].employee_id !== alice) {
      throw new Error(`unexpected rows: ${JSON.stringify(rows)}`)
    }
    return '1 own record'
  })

  await check('employee cannot see another employee timesheet', async () => {
    const rows = await asUser(bobProfile, () =>
      query('select employee_id from public.attendance_records'),
    )
    if (rows.length !== 0) throw new Error(`bob saw ${rows.length} rows`)
    return '0 rows for Bob'
  })

  await check('supervisor sees their assigned team only', async () => {
    const rows = await asUser(supProfile, () =>
      query('select id, supervisor_id from public.employees order by employee_no'),
    )
    const ids = rows.map((row) => row.id)
    if (!ids.includes(supervisor)) throw new Error('supervisor cannot see self')
    if (!ids.includes(alice)) throw new Error('supervisor cannot see assigned employee')
    if (ids.includes(bob)) throw new Error('supervisor saw an unassigned employee')
    return 'self + assigned employee, not Bob'
  })

  await check('admin sees every employee', async () => {
    const rows = await asUser(adminProfile, () => query('select id from public.employees'))
    if (rows.length !== 3) throw new Error(`admin saw ${rows.length}`)
    return '3 employees'
  })

  await check('employee cannot read audit logs', async () => {
    const rows = await asUser(aliceProfile, () => query('select id from public.audit_logs'))
    if (rows.length !== 0) throw new Error(`saw ${rows.length} audit rows`)
    return '0 rows'
  })

  await check('admin can read audit logs', async () => {
    const rows = await asUser(adminProfile, () => query('select id from public.audit_logs'))
    if (rows.length === 0) throw new Error('admin saw no audit rows')
    return `${rows.length} rows`
  })

  await check('employee can update their own phone but not their role', async () => {
    await asUser(aliceProfile, () =>
      query(`update public.profiles set phone = '+639171234567' where id = $1`, [
        aliceProfile,
      ]),
    )
    const phone = await scalar(`select phone from public.profiles where id = $1`, [aliceProfile])
    if (phone !== '+639171234567') throw new Error('phone update did not persist')

    let roleBlocked = false
    try {
      await asUser(aliceProfile, () =>
        query(`update public.profiles set role = 'admin' where id = $1`, [aliceProfile]),
      )
    } catch (error) {
      roleBlocked = /permission denied/i.test(error.message)
    }
    if (!roleBlocked) throw new Error('employee was able to change their role')
    return 'phone updated; role change denied'
  })

  await expectFailure(
    'employee cannot insert attendance directly',
    /permission denied/i,
    () =>
      asUser(aliceProfile, () =>
        query(
          `insert into public.attendance_records (employee_id, work_date)
           values ($1, '2026-11-20')`,
          [alice],
        ),
      ),
  )

  await expectFailure(
    'employee cannot update attendance totals directly',
    /permission denied/i,
    () =>
      asUser(aliceProfile, () =>
        query(
          `update public.attendance_records set worked_minutes = 999 where employee_id = $1`,
          [alice],
        ),
      ),
  )

  await expectFailure(
    'employee cannot insert corrections directly',
    /permission denied/i,
    () =>
      asUser(aliceProfile, () =>
        query(
          `insert into public.attendance_corrections
             (employee_id, work_date, correction_type, requested_time_out, reason)
           values ($1, '2026-11-18', 'missing_time_out', now(),
                   'Direct insert should be denied.')`,
          [alice],
        ),
      ),
  )

  await expectFailure(
    'anon cannot read any table',
    /permission denied/i,
    () => asAnon(() => query('select id from public.employees')),
  )

  // -------------------------------------------------------------------------
  // Phase 3 onboarding + approval
  // -------------------------------------------------------------------------
  const carolProfile = await insertAuthUser('carol@ojt.test', 'Carol Dela Cruz')
  const daveProfile = await insertAuthUser('dave@ojt.test', 'Dave Lim')

  await check('a new sign-up has no employee row and sees no context employee', async () => {
    const context = await asUser(carolProfile, () =>
      scalar(`select public.get_my_context() ->> 'employee'`),
    )
    if (context) throw new Error('employee record created before onboarding')
    return 'employee is null'
  })

  await check('complete_onboarding creates a pending inactive employee', async () => {
    const result = await asUser(carolProfile, () =>
      scalar(
        `select public.complete_onboarding(
           p_employee_no => $1,
           p_first_name => $2,
           p_last_name  => $3,
           p_position   => $4
         )::text`,
        ['ojt-0100', 'carol', 'dela cruz', 'OJT Intern'],
      ),
    )
    const payload = JSON.parse(result)
    if (payload.status !== 'inactive') throw new Error(`status ${payload.status}`)
    if (payload.approved_at !== null) throw new Error('approved_at should be null')
    if (payload.employee_no !== 'OJT-0100') throw new Error('employee no not normalized')

    const row = (
      await query(`select approved_at, status from public.employees where id = $1`, [
        payload.employee_id,
      ])
    )[0]
    if (row.status !== 'inactive' || row.approved_at !== null) throw new Error('row mismatch')
    return 'status=inactive, approved_at=null, employee_no=OJT-0100'
  })

  await check('the profile full name is rebuilt from onboarding fields', async () => {
    const name = await scalar(`select full_name from public.profiles where id = $1`, [
      carolProfile,
    ])
    if (name !== 'carol dela cruz') throw new Error(`name was ${name}`)
    return name
  })

  await expectFailure(
    'a second onboarding submission is rejected',
    /ALREADY_ONBOARDED/,
    () =>
      asUser(carolProfile, () =>
        query(`select public.complete_onboarding('OJT-0101', 'Carol', 'Dela Cruz')`),
      ),
  )

  await expectFailure(
    'duplicate employee numbers cannot be claimed during onboarding',
    /EMPLOYEE_NO_TAKEN/,
    () =>
      asUser(daveProfile, () =>
        query(`select public.complete_onboarding('OJT-0001', 'Dave', 'Lim')`),
      ),
  )

  await expectFailure(
    'invalid employee numbers are rejected before insert',
    /EMPLOYEE_NO_INVALID/,
    () =>
      asUser(daveProfile, () =>
        query(`select public.complete_onboarding('no spaces here', 'Dave', 'Lim')`),
      ),
  )

  await expectFailure(
    'employees cannot read the onboarding queue',
    /FORBIDDEN/,
    () => asUser(daveProfile, () => query(`select * from public.list_onboarding_requests()`)),
  )

  await expectFailure(
    'anon cannot read the onboarding queue',
    /permission denied/i,
    () => asAnon(() => query(`select * from public.list_onboarding_requests()`)),
  )

  await check('administrators see pending requests only', async () => {
    const rows = await asUser(adminProfile, () =>
      query(`select employee_no, submitted_at from public.list_onboarding_requests()`),
    )
    if (rows.length !== 1) throw new Error(`queue had ${rows.length} rows`)
    if (rows[0].employee_no !== 'OJT-0100') throw new Error('wrong row in queue')
    return '1 pending request'
  })

  const carolEmployeeId = await scalar(
    `select id from public.employees where employee_no = 'OJT-0100'`,
  )

  await expectFailure(
    'approval is admin-only',
    /FORBIDDEN/,
    () =>
      asUser(daveProfile, () =>
        query(`select public.review_onboarding($1, true)`, [carolEmployeeId]),
      ),
  )

  await check('admin approval activates the account', async () => {
    await asUser(adminProfile, () =>
      query(`select public.review_onboarding($1, true)`, [carolEmployeeId]),
    )
    const row = (
      await query(
        `select e.status, e.approved_at, e.approved_by, p.is_active
           from public.employees e join public.profiles p on p.id = e.profile_id
          where e.id = $1`,
        [carolEmployeeId],
      )
    )[0]
    if (row.status !== 'active') throw new Error(`status ${row.status}`)
    if (!row.approved_at) throw new Error('approved_at not set')
    if (row.approved_by !== adminProfile) throw new Error('approved_by not recorded')
    if (!row.is_active) throw new Error('profile not activated')
    return 'active, approved_by admin, profile active'
  })

  await expectFailure(
    'a reviewed request cannot be reviewed twice',
    /ALREADY_REVIEWED/,
    () =>
      asUser(adminProfile, () =>
        query(`select public.review_onboarding($1, true)`, [carolEmployeeId]),
      ),
  )

  await check('an approved employee now has context and can be seen by admin', async () => {
    const status = await asUser(carolProfile, () =>
      scalar(`select public.get_my_context() -> 'employee' ->> 'status'`),
    )
    if (status !== 'active') throw new Error(`context status ${status}`)
    return 'context status=active'
  })

  await check('rejecting a pending request requires a reason', async () => {
    const pending = await asUser(daveProfile, () =>
      scalar(
        `select public.complete_onboarding('OJT-0101', 'Dave', 'Lim') ->> 'employee_id'`,
      ),
    )
    let blocked = false
    try {
      await asUser(adminProfile, () =>
        query(`select public.review_onboarding($1, false)`, [pending]),
      )
    } catch (error) {
      blocked = /REJECTION_REASON_REQUIRED/.test(error.message)
    }
    if (!blocked) throw new Error('rejection without a reason was allowed')

    await asUser(adminProfile, () =>
      query(`select public.review_onboarding($1, false, $2)`, [
        pending,
        'Student number does not match the class list.',
      ]),
    )
    const row = (
      await query(
        `select e.status, p.is_active from public.employees e
           join public.profiles p on p.id = e.profile_id where e.id = $1`,
        [pending],
      )
    )[0]
    if (row.status !== 'archived') throw new Error(`status ${row.status}`)
    if (row.is_active) throw new Error('profile left active')
    return 'rejection required a reason; account archived'
  })

  await check('rejected accounts cannot write their own profile activation', async () => {
    let blocked = false
    try {
      await asUser(daveProfile, () =>
        query(`update public.profiles set is_active = true where id = $1`, [daveProfile]),
      )
    } catch (error) {
      blocked = /permission denied/i.test(error.message)
    }
    if (!blocked) throw new Error('rejected user re-activated their own profile')
    return 'self re-activation denied'
  })

  await check('the database blocks an active employee without approval', async () => {
    let blocked = false
    try {
      await query(
        `insert into public.employees
           (profile_id, employee_no, first_name, last_name, email, approved_at, status)
         values (gen_random_uuid(), 'OJT-9999', 'No', 'Approval', 'no@ojt.test', null, 'active')`,
      )
    } catch (error) {
      blocked = /employees_active_approved/.test(error.message)
    }
    if (!blocked) throw new Error('active employee without approval was allowed')
    return 'check constraint enforced'
  })

  // -------------------------------------------------------------------------
  // Automatic approval setting
  // -------------------------------------------------------------------------
  await expectFailure(
    'only administrators can change the approval setting',
    /FORBIDDEN/,
    () => asUser(aliceProfile, () => query(`select public.set_auto_approve(true)`)),
  )

  await expectFailure(
    'employees cannot read approval settings',
    /FORBIDDEN/,
    () => asUser(aliceProfile, () => query(`select public.get_onboarding_settings()`)),
  )

  await check('automatic approval is off by default', async () => {
    const settings = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.get_onboarding_settings()::text`),
      ),
    )
    if (settings.auto_approve_onboarding !== false) throw new Error('default was not false')
    return 'auto_approve_onboarding=false'
  })

  const erinProfile = await insertAuthUser('erin@ojt.test', 'Erin Mendoza')

  await check('with the setting off, submissions still wait for approval', async () => {
    const status = await asUser(erinProfile, () =>
      scalar(`select public.complete_onboarding('OJT-0200', 'Erin', 'Mendoza') ->> 'status'`),
    )
    if (status !== 'inactive') throw new Error(`status ${status}`)
    return 'status=inactive'
  })

  await check('enabling auto-approve clears the pending queue', async () => {
    const payload = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.set_auto_approve(true, true)::text`),
      ),
    )
    if (payload.auto_approve_onboarding !== true) throw new Error('setting not enabled')
    if (payload.approved_pending !== 1) throw new Error(`approved ${payload.approved_pending}`)

    const settings = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.get_onboarding_settings()::text`),
      ),
    )
    if (settings.pending_count !== 0) throw new Error(`pending ${settings.pending_count}`)
    return '1 pending request approved; queue empty'
  })

  await check('an auto-approved student is immediately active', async () => {
    const row = (
      await query(
        `select status, approved_at, approved_by
           from public.employees where employee_no = 'OJT-0200'`,
      )
    )[0]
    if (row.status !== 'active') throw new Error(`status ${row.status}`)
    if (!row.approved_at) throw new Error('approved_at missing')
    if (row.approved_by !== adminProfile) throw new Error('approved_by not recorded')
    return 'active with approver recorded'
  })

  await check('while enabled, new submissions are approved on the spot', async () => {
    const frankProfile = await insertAuthUser('frank@ojt.test', 'Frank Bautista')
    const payload = JSON.parse(
      await asUser(frankProfile, () =>
        scalar(`select public.complete_onboarding('OJT-0201', 'Frank', 'Bautista')::text`),
      ),
    )
    if (payload.status !== 'active') throw new Error(`status ${payload.status}`)
    if (payload.auto_approved !== true) throw new Error('auto_approved flag missing')
    return 'status=active, auto_approved=true'
  })

  await check('turning the setting off restores manual review', async () => {
    await asUser(adminProfile, () => query(`select public.set_auto_approve(false)`))
    const graceProfile = await insertAuthUser('grace@ojt.test', 'Grace Ocampo')
    const payload = JSON.parse(
      await asUser(graceProfile, () =>
        scalar(`select public.complete_onboarding('OJT-0202', 'Grace', 'Ocampo')::text`),
      ),
    )
    if (payload.status !== 'inactive') throw new Error(`status ${payload.status}`)
    if (payload.approved_at !== null) throw new Error('approved_at should be null')
    return 'status=inactive again'
  })

  // -------------------------------------------------------------------------
  // Phase 6 time clock
  // -------------------------------------------------------------------------
  await expectFailure(
    'employees cannot create work schedules',
    /FORBIDDEN/,
    () =>
      asUser(aliceProfile, () =>
        query(
          `select public.create_work_schedule(
             'Sneaky', null, 0, '{1,2,3,4,5}'::smallint[],
             '[{"label":"All day","start":"08:00","end":"17:00"}]'::jsonb,
             false
           )`,
        ),
      ),
  )

  await expectFailure(
    'a schedule with no paid periods is rejected',
    /PERIODS_INVALID/,
    () =>
      asUser(adminProfile, () =>
        query(
          `select public.create_work_schedule('Empty', null, 0, '{1,2,3,4,5}'::smallint[], '[]'::jsonb, false)`,
        ),
      ),
  )

  await check('a schedule with duplicate names is rejected', async () => {
    let blocked = false
    try {
      await asUser(adminProfile, () =>
        query(
          `select public.create_work_schedule(
             'standard ojt', null, 0, '{1,2,3,4,5}'::smallint[],
             '[{"label":"All day","start":"08:00","end":"17:00"}]'::jsonb,
             false
           )`,
        ),
      )
    } catch (error) {
      blocked = /SCHEDULE_NAME_TAKEN/.test(error.message)
    }
    if (!blocked) throw new Error('duplicate schedule name was allowed')
    return 'case-insensitive uniqueness enforced'
  })

  await check('ensure_default_schedule reuses an existing schedule', async () => {
    const payload = JSON.parse(
      await asUser(adminProfile, () => scalar(`select public.ensure_default_schedule()::text`)),
    )
    if (payload.created !== false) throw new Error('created a duplicate schedule')
    return `reused "${payload.name}"`
  })

  const allDay = JSON.parse(
    await asUser(adminProfile, () =>
      scalar(
        `select public.create_work_schedule(
           'OJT All Day',
           'Test schedule covering the whole day',
           0,
           '{1,2,3,4,5,6,7}'::smallint[],
           '[{"label":"All day","start":"00:00","end":"23:59"}]'::jsonb,
           false
         )::text`,
      ),
    ),
  )

  await check('create_work_schedule stores periods and assigns on request', async () => {
    const periods = await query(
      `select label, start_time, end_time, sort_order
         from public.schedule_periods where schedule_id = $1 order by sort_order`,
      [allDay.id],
    )
    if (periods.length !== 1) throw new Error(`${periods.length} periods stored`)
    if (periods[0].label !== 'All day') throw new Error('period label lost')
    return 'periods persisted'
  })

  const hollyProfile = await insertAuthUser('holly@ojt.test', 'Holly Tan')
  const holly = (
    await query(
      `insert into public.employees
         (profile_id, employee_no, first_name, last_name, email, schedule_id,
          employment_type, date_hired)
       values ($1, 'OJT-0300', 'Holly', 'Tan', 'holly@ojt.test', NULL,
               'intern', current_date)
       returning id`,
      [hollyProfile],
    )
  )[0].id

  await check('unassigned employees cannot time in', async () => {
    let blocked = false
    try {
      await asUser(hollyProfile, () => query(`select public.time_in()`))
    } catch (error) {
      blocked = /SCHEDULE_NOT_ASSIGNED/.test(error.message)
    }
    if (!blocked) throw new Error('time in succeeded without a schedule')
    return 'SCHEDULE_NOT_ASSIGNED'
  })

  await check('assign_schedule_to_unassigned works for admins only', async () => {
    const payload = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.assign_schedule_to_unassigned($1::uuid)::text`, [allDay.id]),
      ),
    )
    if (payload.assigned_employees < 1) throw new Error('nothing assigned')
    const assigned = await scalar(`select schedule_id from public.employees where id = $1`, [
      holly,
    ])
    if (assigned !== allDay.id) throw new Error('employee pointer not updated')
    return `${payload.assigned_employees} employee(s) assigned`
  })

  await check('admins can delete an unused schedule and it is audited', async () => {
    const temp = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(
          `select public.create_work_schedule(
             'Delete Me', 'Throwaway test schedule', 0, '{1,2,3,4,5}'::smallint[],
             '[{"label":"All day","start":"08:00","end":"17:00"}]'::jsonb, false
           )::text`,
        ),
      ),
    )
    const result = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.delete_work_schedule($1::uuid)::text`, [temp.id]),
      ),
    )
    if (result.deleted !== true || result.name !== 'Delete Me') {
      throw new Error(`result=${JSON.stringify(result)}`)
    }
    const left = await scalar(`select count(*)::int from public.work_schedules where id = $1`, [
      temp.id,
    ])
    if (left !== 0) throw new Error('schedule still present')
    const audited = await scalar(
      `select count(*)::int from public.audit_logs
       where action = 'schedule.deleted' and entity_id = $1`,
      [temp.id],
    )
    if (audited !== 1) throw new Error(`audit rows=${audited}`)
    return 'deleted, periods cascaded, audit written'
  })

  await expectFailure(
    'a schedule still assigned to an employee cannot be deleted',
    /SCHEDULE_ASSIGNED/,
    () =>
      asUser(adminProfile, () =>
        query(`select public.delete_work_schedule($1::uuid)`, [allDay.id]),
      ),
  )

  await check('a schedule referenced by attendance cannot be deleted', async () => {
    const temp = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(
          `select public.create_work_schedule(
             'Attendance History', null, 0, '{1,2,3,4,5}'::smallint[],
             '[{"label":"All day","start":"08:00","end":"17:00"}]'::jsonb, false
           )::text`,
        ),
      ),
    )
    await query(
      `insert into public.attendance_records (employee_id, work_date, schedule_id)
       values ($1, '2026-01-05', $2)`,
      [holly, temp.id],
    )
    let blocked = false
    try {
      await asUser(adminProfile, () =>
        query(`select public.delete_work_schedule($1::uuid)`, [temp.id]),
      )
    } catch (error) {
      blocked = /SCHEDULE_HAS_ATTENDANCE/.test(error.message)
    }
    if (!blocked) throw new Error('schedule with attendance was deleted')
    return 'SCHEDULE_HAS_ATTENDANCE'
  })

  await expectFailure(
    'employees cannot delete schedules',
    /FORBIDDEN/,
    () =>
      asUser(hollyProfile, () => query(`select public.delete_work_schedule($1::uuid)`, [allDay.id])),
  )

  await check('delete_work_schedule can unassign employees when asked', async () => {
    const temp = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(
          `select public.create_work_schedule(
             'Force Delete', null, 0, '{1,2,3,4,5}'::smallint[],
             '[{"label":"All day","start":"08:00","end":"17:00"}]'::jsonb, false
           )::text`,
        ),
      ),
    )
    await query(`update public.employees set schedule_id = $1 where id = $2`, [temp.id, holly])

    const result = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.delete_work_schedule($1::uuid, true)::text`, [temp.id]),
      ),
    )
    if (result.deleted !== true || result.unassigned_employees !== 1) {
      throw new Error(`result=${JSON.stringify(result)}`)
    }

    const schedule = await scalar(`select schedule_id from public.employees where id = $1`, [
      holly,
    ])
    if (schedule !== null) throw new Error('employee still points at the deleted schedule')

    await query(`update public.employees set schedule_id = $1 where id = $2`, [allDay.id, holly])
    return 'deleted and 1 employee unassigned'
  })

  // -------------------------------------------------------------------------
  // Self-service schedule joining
  // -------------------------------------------------------------------------
  const joinable = JSON.parse(
    await asUser(adminProfile, () =>
      scalar(
        `select public.create_work_schedule(
           'Joinable Shift', 'Open for students to join', 5, '{1,2,3,4,5}'::smallint[],
           '[{"label":"Day","start":"08:00","end":"17:00"}]'::jsonb, false
         )::text`,
      ),
    ),
  )

  const ivanProfile = await insertAuthUser('ivan@ojt.test', 'Ivan Cruz')
  const ivan = (
    await query(
      `insert into public.employees
         (profile_id, employee_no, first_name, last_name, email, schedule_id,
          employment_type, date_hired)
       values ($1, 'OJT-0400', 'Ivan', 'Cruz', 'ivan@ojt.test', NULL,
               'intern', current_date)
       returning id`,
      [ivanProfile],
    )
  )[0].id

  await check('list_joinable_schedules shows active schedules to employees', async () => {
    const rows = JSON.parse(
      await asUser(ivanProfile, () => scalar(`select public.list_joinable_schedules()::text`)),
    )
    const row = rows.find((item) => item.id === joinable.id)
    if (!row) throw new Error('joinable schedule missing')
    if (row.is_mine !== false) throw new Error('is_mine should be false')
    if (row.periods.length !== 1) throw new Error('periods missing')
    return `${rows.length} active schedules, periods included`
  })

  await check('an employee can join a published schedule', async () => {
    const payload = JSON.parse(
      await asUser(ivanProfile, () =>
        scalar(`select public.join_work_schedule($1::uuid)::text`, [joinable.id]),
      ),
    )
    if (payload.changed !== true) throw new Error('join reported no change')
    const scheduleId = await scalar(`select schedule_id from public.employees where id = $1`, [
      ivan,
    ])
    if (scheduleId !== joinable.id) throw new Error('employee pointer not updated')
    const assignment = await scalar(
      `select count(*)::int from public.schedule_assignments
       where employee_id = $1 and schedule_id = $2 and effective_to is null`,
      [ivan, joinable.id],
    )
    if (assignment !== 1) throw new Error('assignment row missing')
    return 'employee pointed at the schedule and assignment written'
  })

  await check('joining the same schedule again is a no-op', async () => {
    const payload = JSON.parse(
      await asUser(ivanProfile, () =>
        scalar(`select public.join_work_schedule($1::uuid)::text`, [joinable.id]),
      ),
    )
    if (payload.changed !== false) throw new Error('duplicate join changed the schedule')
    return 'changed=false'
  })

  await check('joining another schedule switches it from today', async () => {
    const payload = JSON.parse(
      await asUser(ivanProfile, () =>
        scalar(`select public.join_work_schedule($1::uuid)::text`, [allDay.id]),
      ),
    )
    if (payload.changed !== true) throw new Error('switch reported no change')
    const open = await query(
      `select schedule_id from public.schedule_assignments
       where employee_id = $1 and effective_to is null`,
      [ivan],
    )
    if (open.length !== 1 || open[0].schedule_id !== allDay.id) {
      throw new Error(`open assignments=${JSON.stringify(open)}`)
    }
    const stale = await scalar(
      `select count(*)::int from public.schedule_assignments
       where employee_id = $1 and schedule_id = $2 and effective_to is null`,
      [ivan, joinable.id],
    )
    if (stale !== 0) throw new Error('previous assignment still open')
    return 'previous assignment closed, new one active'
  })

  await check('an employee with an open time-in cannot switch schedules', async () => {
    await asUser(ivanProfile, () => query(`select public.time_in()`))
    let blocked = false
    try {
      await asUser(ivanProfile, () =>
        query(`select public.join_work_schedule($1::uuid)`, [joinable.id]),
      )
    } catch (error) {
      blocked = /OPEN_SESSION_EXISTS/.test(error.message)
    }
    await asUser(ivanProfile, () => query(`select public.time_out()`))
    if (!blocked) throw new Error('schedule switched with an open session')
    return 'OPEN_SESSION_EXISTS'
  })

  await check('inactive schedules cannot be joined and are hidden', async () => {
    const hidden = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(
          `select public.create_work_schedule(
             'Hidden Shift', null, 0, '{1,2,3,4,5}'::smallint[],
             '[{"label":"Day","start":"08:00","end":"17:00"}]'::jsonb, false
           )::text`,
        ),
      ),
    )
    await query(`update public.work_schedules set is_active = false where id = $1`, [hidden.id])

    const rows = JSON.parse(
      await asUser(ivanProfile, () => scalar(`select public.list_joinable_schedules()::text`)),
    )
    if (rows.some((item) => item.id === hidden.id)) throw new Error('inactive schedule listed')

    let blocked = false
    try {
      await asUser(ivanProfile, () =>
        query(`select public.join_work_schedule($1::uuid)`, [hidden.id]),
      )
    } catch (error) {
      blocked = /SCHEDULE_INACTIVE/.test(error.message)
    }
    if (!blocked) throw new Error('inactive schedule was joined')
    return 'hidden and SCHEDULE_INACTIVE'
  })

  await check('an employee can leave a schedule and time in locks again', async () => {
    const payload = JSON.parse(
      await asUser(ivanProfile, () => scalar(`select public.leave_work_schedule()::text`)),
    )
    if (payload.changed !== true) throw new Error('leave reported no change')

    const scheduleId = await scalar(`select schedule_id from public.employees where id = $1`, [
      ivan,
    ])
    if (scheduleId !== null) throw new Error('employee still points at a schedule')

    const open = await scalar(
      `select count(*)::int from public.schedule_assignments
       where employee_id = $1 and effective_to is null`,
      [ivan],
    )
    if (open !== 0) throw new Error('open assignment left behind')

    const audited = await scalar(
      `select count(*)::int from public.audit_logs
       where action = 'schedule.left' and entity_id = $1`,
      [ivan],
    )
    if (audited !== 1) throw new Error(`audit rows=${audited}`)

    const again = JSON.parse(
      await asUser(ivanProfile, () => scalar(`select public.leave_work_schedule()::text`)),
    )
    if (again.changed !== false) throw new Error('leaving twice reported a change')

    await asUser(ivanProfile, () =>
      query(`select public.join_work_schedule($1::uuid)`, [allDay.id]),
    )
    return 'left, audited, rejoin works'
  })

  await check('admins can force-delete an attendance-backed schedule', async () => {
    const temp = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(
          `select public.create_work_schedule(
             'Force Attendance', null, 0, '{1,2,3,4,5}'::smallint[],
             '[{"label":"Day","start":"08:00","end":"17:00"}]'::jsonb, false
           )::text`,
        ),
      ),
    )
    await query(
      `insert into public.attendance_records (employee_id, work_date, schedule_id)
       values ($1, '2026-01-06', $2)`,
      [ivan, temp.id],
    )

    const listed = JSON.parse(
      await asUser(adminProfile, () => scalar(`select public.list_work_schedules()::text`)),
    )
    const row = listed.find((item) => item.id === temp.id)
    if (!row || row.attendance_days !== 1) {
      throw new Error(`attendance_days=${row?.attendance_days}`)
    }

    let blocked = false
    try {
      await asUser(adminProfile, () =>
        query(`select public.delete_work_schedule($1::uuid)`, [temp.id]),
      )
    } catch (error) {
      blocked = /SCHEDULE_HAS_ATTENDANCE/.test(error.message)
    }
    if (!blocked) throw new Error('attendance-backed schedule deleted without force')

    const result = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.delete_work_schedule($1::uuid, false, true)::text`, [temp.id]),
      ),
    )
    if (result.deleted !== true || result.detached_attendance_days !== 1) {
      throw new Error(`result=${JSON.stringify(result)}`)
    }

    const record = (
      await query(
        `select schedule_id from public.attendance_records
         where employee_id = $1 and work_date = '2026-01-06'`,
        [ivan],
      )
    )[0]
    if (!record) throw new Error('attendance row was erased')
    if (record.schedule_id !== null) throw new Error('attendance still linked to deleted schedule')
    return 'schedule removed, attendance row kept and detached'
  })

  await expectFailure(
    'employees cannot delete attendance records',
    /FORBIDDEN/,
    () =>
      asUser(ivanProfile, () =>
        scalar(
          `select public.delete_attendance_record(
             (select id from public.attendance_records where employee_id = $1 limit 1),
             'Trying to clean my own record'
           )::text`,
          [ivan],
        ),
      ),
  )

  await check('deleting an attendance day requires a reason', async () => {
    const recordId = await scalar(
      `select id from public.attendance_records
       where employee_id = $1 and work_date = '2026-01-06'`,
      [ivan],
    )
    let blocked = false
    try {
      await asUser(adminProfile, () =>
        query(`select public.delete_attendance_record($1::uuid, 'nope')`, [recordId]),
      )
    } catch (error) {
      blocked = /REASON_REQUIRED/.test(error.message)
    }
    if (!blocked) throw new Error('short reason was accepted')
    return 'REASON_REQUIRED'
  })

  await check('admins can delete an attendance day and the audit keeps a snapshot', async () => {
    const recordId = await scalar(
      `select id from public.attendance_records
       where employee_id = $1 and work_date = '2026-01-06'`,
      [ivan],
    )
    const result = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(
          `select public.delete_attendance_record($1::uuid, 'Test punch during setup')::text`,
          [recordId],
        ),
      ),
    )
    if (result.deleted !== true || result.work_date !== '2026-01-06') {
      throw new Error(`result=${JSON.stringify(result)}`)
    }

    const left = await scalar(`select count(*)::int from public.attendance_records where id = $1`, [
      recordId,
    ])
    if (left !== 0) throw new Error('record still present')

    const audit = (
      await query(
        `select before_data, after_data from public.audit_logs
         where action = 'attendance.deleted' and entity_id = $1
         order by created_at desc limit 1`,
        [recordId],
      )
    )[0]
    if (!audit) throw new Error('audit row missing')
    if (audit.before_data.work_date !== '2026-01-06') throw new Error('snapshot missing date')
    if (audit.after_data.reason !== 'Test punch during setup') throw new Error('reason not audited')
    return 'record removed, snapshot and reason audited'
  })

  await check('time_in opens a session and creates the daily record', async () => {
    await asUser(hollyProfile, () => query(`select public.time_in()`))

    const record = (
      await query(
        `select * from public.attendance_records where employee_id = $1 and work_date = (
           now() at time zone 'Asia/Manila'
         )::date`,
        [holly],
      )
    )[0]
    if (!record) throw new Error('attendance record missing')
    if (!record.first_time_in) throw new Error('first_time_in missing')

    const session = (
      await query(
        `select * from public.attendance_sessions where employee_id = $1 and time_out is null`,
        [holly],
      )
    )[0]
    if (!session) throw new Error('open session missing')
    if (session.source !== 'web') throw new Error('source not recorded')
    return 'open session + record created'
  })

  await expectFailure(
    'a second time-in is rejected',
    /ALREADY_TIMED_IN/,
    () => asUser(hollyProfile, () => query(`select public.time_in()`)),
  )

  await check('time_out closes the session', async () => {
    await asUser(hollyProfile, () => query(`select public.time_out()`))
    const session = (
      await query(
        `select * from public.attendance_sessions where employee_id = $1 order by time_in desc limit 1`,
        [holly],
      )
    )[0]
    if (!session.time_out) throw new Error('session still open')
    if (session.worked_minutes === null) throw new Error('worked minutes not set')
    return `closed, worked=${session.worked_minutes}m`
  })

  await expectFailure(
    'time_out without an open session is rejected',
    /NOT_TIMED_IN/,
    () => asUser(hollyProfile, () => query(`select public.time_out()`)),
  )

  await check('get_my_day returns the punch state', async () => {
    const payload = JSON.parse(
      await asUser(hollyProfile, () => scalar(`select public.get_my_day()::text`)),
    )
    if (!payload.employee_id) throw new Error('employee id missing')
    if (!Array.isArray(payload.sessions) || payload.sessions.length !== 1)
      throw new Error('session list wrong')
    if (payload.open_session !== null) throw new Error('a session is still open')
    if (payload.record.worked_minutes === null) throw new Error('record totals missing')
    return 'day payload complete'
  })

  // -------------------------------------------------------------------------
  // Attendance math (deterministic, using synthetic punches)
  // -------------------------------------------------------------------------
  const mathProfile = await insertAuthUser('math@ojt.test', 'Math Check')

  const mathEmployee = (
    await query(
      `insert into public.employees
         (profile_id, employee_no, first_name, last_name, email, schedule_id,
          employment_type, date_hired)
       values ($1, 'OJT-0301', 'Math', 'Check', 'math@ojt.test', $2,
               'intern', current_date)
       returning id`,
      [mathProfile, schedule],
    )
  )[0].id

  const mathRecord = (
    await query(
      `insert into public.attendance_records (employee_id, work_date, schedule_id)
       values ($1, '2026-11-18', $2) returning id`,
      [mathEmployee, schedule],
    )
  )[0].id

  await query(
    `insert into public.attendance_sessions
       (attendance_record_id, employee_id, work_date, time_in, time_out, source)
     values ($1, $2, '2026-11-18',
             '2026-11-18T08:30:00+08', '2026-11-18T16:30:00+08', 'manual')`,
    [mathRecord, mathEmployee],
  )

  await check('worked minutes exclude the unpaid lunch break', async () => {
    const record = (
      await query(`select * from private.recompute_attendance($1)`, [mathRecord])
    )[0]
    if (record.worked_minutes !== 420) throw new Error(`worked=${record.worked_minutes}`)
    return '420 minutes (7h), not 480'
  })

  await check('late and undertime are measured against the schedule', async () => {
    const record = (await query(`select * from public.attendance_records where id = $1`, [mathRecord]))[0]
    if (record.late_minutes !== 20) throw new Error(`late=${record.late_minutes}`)
    if (record.undertime_minutes !== 60) throw new Error(`undertime=${record.undertime_minutes}`)
    if (record.overtime_minutes !== 0) throw new Error(`overtime=${record.overtime_minutes}`)
    if (record.status !== 'late') throw new Error(`status=${record.status}`)
    return 'late=20, undertime=60, overtime=0'
  })

  await check('time outside the schedule counts as overtime', async () => {
    await query(
      `insert into public.attendance_sessions
         (attendance_record_id, employee_id, work_date, time_in, time_out, source)
       values ($1, $2, '2026-11-18',
               '2026-11-18T17:30:00+08', '2026-11-18T18:15:00+08', 'manual')`,
      [mathRecord, mathEmployee],
    )
    const record = (
      await query(`select * from private.recompute_attendance($1)`, [mathRecord])
    )[0]
    if (record.overtime_minutes !== 45) throw new Error(`overtime=${record.overtime_minutes}`)
    if (record.worked_minutes !== 420) throw new Error(`worked=${record.worked_minutes}`)
    return 'overtime=45, worked unchanged'
  })

  await check('a rest day with no punches is not marked present', async () => {
    const sundayRecord = (
      await query(
        `insert into public.attendance_records (employee_id, work_date, schedule_id)
         values ($1, '2026-11-22', $2) returning id`,
        [mathEmployee, schedule],
      )
    )[0].id
    const record = (
      await query(`select * from private.recompute_attendance($1)`, [sundayRecord])
    )[0]
    if (record.status !== 'rest_day') throw new Error(`status=${record.status}`)
    return 'rest_day'
  })

  // -------------------------------------------------------------------------
  // Phase 4: administrator dashboard
  // -------------------------------------------------------------------------
  await expectFailure(
    'employees cannot read the admin dashboard',
    /FORBIDDEN/,
    () => asUser(aliceProfile, () => query(`select public.admin_dashboard()`)),
  )

  await check('admin_dashboard returns live database totals', async () => {
    const payload = JSON.parse(
      await asUser(adminProfile, () => scalar(`select public.admin_dashboard()::text`)),
    )
    if (typeof payload.total_employees !== 'number' || payload.total_employees < 4) {
      throw new Error(`total_employees=${payload.total_employees}`)
    }
    if (!Array.isArray(payload.trend) || payload.trend.length !== 14) {
      throw new Error('trend must cover 14 days')
    }
    if (typeof payload.worked_minutes_today !== 'number') {
      throw new Error('worked_minutes_today missing')
    }
    return `${payload.total_employees} active, ${payload.trend.length}-day trend`
  })

  // -------------------------------------------------------------------------
  // Phase 5: employee management and departments
  // -------------------------------------------------------------------------
  await check('list_employees searches, filters, and paginates', async () => {
    const search = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(
          `select public.list_employees('alice', null, null, 1, 10)::text`,
        ),
      ),
    )
    if (search.total !== 1 || search.items[0].first_name !== 'Alice') {
      throw new Error(`search returned ${search.total}`)
    }

    const paged = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.list_employees(null, null, null, 1, 2)::text`),
      ),
    )
    if (paged.items.length !== 2) throw new Error(`page size ${paged.items.length}`)
    if (paged.total < 4) throw new Error(`total ${paged.total}`)
    return 'search + pagination correct'
  })

  await expectFailure(
    'employees cannot list the employee directory',
    /FORBIDDEN/,
    () => asUser(aliceProfile, () => query(`select public.list_employees()`) ),
  )

  await check('update_employee syncs the profile name and audits the change', async () => {
    await asUser(adminProfile, () =>
      query(
        `select public.update_employee(
           $1::uuid, 'Robert', null, 'Reyes', 'OJT Intern II',
           $2::uuid, 'intern', '2026-01-05', null
         )`,
        [bob, dept],
      ),
    )

    const name = await scalar(`select full_name from public.profiles where id = $1`, [
      bobProfile,
    ])
    if (name !== 'Robert Reyes') throw new Error(`profile name ${name}`)

    const audits = await scalar(
      `select count(*) from public.audit_logs
       where action = 'employee.updated' and entity_id = $1`,
      [bob],
    )
    if (Number(audits) < 1) throw new Error('no audit entry')
    return 'profile name synced, audit written'
  })

  await check('create_department validates codes and records an audit', async () => {
    const created = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.create_department('Quality Assurance', 'QA')::text`),
      ),
    )
    if (created.code !== 'QA') throw new Error('code not normalized')
    return 'QA created'
  })

  await expectFailure(
    'duplicate department codes are rejected',
    /DEPARTMENT_CODE_TAKEN/,
    () =>
      asUser(adminProfile, () =>
        query(`select public.create_department('Quality Assurance 2', 'QA')`),
      ),
  )

  await expectFailure(
    'employees cannot create departments',
    /FORBIDDEN/,
    () =>
      asUser(aliceProfile, () =>
        query(`select public.create_department('Shadow', 'SH')`),
      ),
  )

  await check('deactivating an employee with an open punch is blocked', async () => {
    await query(`update public.employees set approved_at = now(), approved_by = $1 where id = $2`, [
      adminProfile,
      bob,
    ])

    const recordId = (
      await query(
        `insert into public.attendance_records (employee_id, work_date, schedule_id)
         values ($1, current_date, $2)
         on conflict (employee_id, work_date) do update set schedule_id = excluded.schedule_id
         returning id`,
        [bob, schedule],
      )
    )[0].id

    await query(
      `insert into public.attendance_sessions
         (attendance_record_id, employee_id, work_date, time_in, source)
       values ($1, $2, current_date, now(), 'manual')`,
      [recordId, bob],
    )

    let blocked = false
    try {
      await asUser(adminProfile, () =>
        query(`select public.set_employee_status($1::uuid, 'inactive', 'Testing')`, [bob]),
      )
    } catch (error) {
      blocked = /OPEN_SESSION/.test(error.message)
    }

    await query(
      `update public.attendance_sessions set time_out = now()
       where employee_id = $1 and time_out is null`,
      [bob],
    )

    if (!blocked) throw new Error('deactivation was allowed with an open punch')
    return 'OPEN_SESSION raised'
  })

  await check('set_employee_status deactivates and reactivates', async () => {
    await asUser(adminProfile, () =>
      query(`select public.set_employee_status($1::uuid, 'inactive', 'Completed OJT')`, [bob]),
    )
    const inactive = await scalar(`select status from public.employees where id = $1`, [bob])
    const profileInactive = await scalar(`select is_active from public.profiles where id = $1`, [
      bobProfile,
    ])
    if (inactive !== 'inactive' || profileInactive !== false) {
      throw new Error(`status=${inactive}, profile_active=${profileInactive}`)
    }

    await asUser(adminProfile, () =>
      query(`select public.set_employee_status($1::uuid, 'active', 'Returned')`, [bob]),
    )
    const active = await scalar(`select status from public.employees where id = $1`, [bob])
    if (active !== 'active') throw new Error(`status=${active}`)
    return 'inactive → active'
  })

  // -------------------------------------------------------------------------
  // Phase 7: DTR payloads and attendance listings
  // -------------------------------------------------------------------------
  await check('get_dtr returns every day in the period with totals', async () => {
    const payload = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(
          `select public.get_dtr($1::uuid, '2026-11-18', '2026-11-22')::text`,
          [mathEmployee],
        ),
      ),
    )
    if (payload.rows.length !== 5) throw new Error(`rows=${payload.rows.length}`)
    if (payload.totals.worked_minutes !== 420) {
      throw new Error(`worked=${payload.totals.worked_minutes}`)
    }
    if (payload.totals.days_present !== 1) {
      throw new Error(`days_present=${payload.totals.days_present}`)
    }
    if (payload.employee.schedule !== 'Standard OJT') {
      throw new Error('schedule missing from payload')
    }
    return '5 days, 420 minutes, 1 day present'
  })

  await expectFailure(
    'get_dtr rejects periods longer than two months',
    /PERIOD_TOO_LONG/,
    () =>
      asUser(adminProfile, () =>
        query(
          `select public.get_dtr($1::uuid, '2026-01-01', '2026-12-31')`,
          [mathEmployee],
        ),
      ),
  )

  await check('employees can read their own DTR but not a classmate’s', async () => {
    const own = JSON.parse(
      await asUser(mathProfile, () =>
        scalar(
          `select public.get_dtr($1::uuid, '2026-11-18', '2026-11-18')::text`,
          [mathEmployee],
        ),
      ),
    )
    if (own.rows.length !== 1) throw new Error('own DTR failed')

    let blocked = false
    try {
      await asUser(aliceProfile, () =>
        query(`select public.get_dtr($1::uuid, '2026-11-18', '2026-11-18')`, [mathEmployee]),
      )
    } catch (error) {
      blocked = /FORBIDDEN/.test(error.message)
    }
    if (!blocked) throw new Error('cross-employee DTR was allowed')
    return 'self allowed, classmate blocked'
  })

  await check('list_attendance returns filtered rows for reviewers only', async () => {
    const page = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(
          `select public.list_attendance('2026-11-18', '2026-11-22', null, 1, 25)::text`,
        ),
      ),
    )
    if (page.total < 2) throw new Error(`total=${page.total}`)
    if (!page.items.some((item) => item.employee_no === 'OJT-0301')) {
      throw new Error('math record missing')
    }

    let blocked = false
    try {
      await asUser(mathProfile, () =>
        query(`select public.list_attendance('2026-11-18', '2026-11-22')`),
      )
    } catch (error) {
      blocked = /FORBIDDEN/.test(error.message)
    }
    if (!blocked) throw new Error('employee read the attendance list')
    return `${page.total} rows, employee blocked`
  })

  // -------------------------------------------------------------------------
  // Phase 9: correction requests and reviews
  // -------------------------------------------------------------------------
  await expectFailure(
    'corrections need a meaningful reason',
    /REASON_TOO_SHORT/,
    () =>
      asUser(mathProfile, () =>
        query(
          `select public.request_correction(
             '2026-11-19', 'missing_time_in', '2026-11-19T08:00:00+08', null, 'oops'
           )`,
        ),
      ),
  )

  await expectFailure(
    'corrections cannot target a future date',
    /FUTURE_DATE/,
    () =>
      asUser(mathProfile, () =>
        query(
          `select public.request_correction(
             (current_date + 5), 'missing_time_in', now(), null,
             'I am planning ahead for a missed punch.'
           )`,
        ),
      ),
  )

  const correction = JSON.parse(
    await asUser(mathProfile, () =>
      scalar(
        `select public.request_correction(
           '2026-11-19', 'missing_time_in', '2026-11-19T08:00:00+08', null,
           'Forgot to time in after the site visit.'
         )::text`,
      ),
    ),
  )

  await check('request_correction creates a pending request', async () => {
    if (correction.status !== 'pending') throw new Error(`status=${correction.status}`)
    const mine = JSON.parse(
      await asUser(mathProfile, () => scalar(`select public.list_my_corrections()::text`)),
    )
    if (!Array.isArray(mine) || mine.length !== 1) throw new Error(`mine=${mine.length}`)
    return 'pending request visible to the employee'
  })

  await expectFailure(
    'employees cannot review correction queues',
    /FORBIDDEN/,
    () => asUser(mathProfile, () => query(`select public.list_corrections()`)),
  )

  await check('approving a correction creates the punch and recomputes the day', async () => {
    await asUser(adminProfile, () =>
      query(`select public.review_correction($1::uuid, true, 'Verified against the logbook')`, [
        correction.id,
      ]),
    )

    const row = (
      await query(
        `select r.*, c.status, c.applied_at
           from public.attendance_records r
           join public.attendance_corrections c on c.id = $2
          where r.employee_id = $1 and r.work_date = '2026-11-19'`,
        [mathEmployee, correction.id],
      )
    )[0]
    if (!row) throw new Error('attendance record missing')
    if (!row.first_time_in) throw new Error('time in not applied')
    if (row.status !== 'approved' || !row.applied_at) throw new Error('correction not approved')
    return 'session created, record recomputed'
  })

  await check('incorrect_time fixes both ends of a single punch pair', async () => {
    const closeOut = JSON.parse(
      await asUser(mathProfile, () =>
        scalar(
          `select public.request_correction(
             '2026-11-19', 'missing_time_out', null, '2026-11-19T17:00:00+08',
             'Forgot to time out at the end of the day.'
           )::text`,
        ),
      ),
    )
    await asUser(adminProfile, () =>
      query(`select public.review_correction($1::uuid, true, 'Closed the open punch')`, [
        closeOut.id,
      ]),
    )

    const fixPair = JSON.parse(
      await asUser(mathProfile, () =>
        scalar(
          `select public.request_correction(
             '2026-11-19', 'incorrect_time', '2026-11-19T08:15:00+08',
             '2026-11-19T16:45:00+08', 'The morning and afternoon punches were both wrong.'
           )::text`,
        ),
      ),
    )
    await asUser(adminProfile, () =>
      query(`select public.review_correction($1::uuid, true, 'Matched the logbook')`, [
        fixPair.id,
      ]),
    )

    const session = (
      await query(
        `select
           to_char(time_in at time zone 'Asia/Manila', 'HH24:MI') as in_time,
           to_char(time_out at time zone 'Asia/Manila', 'HH24:MI') as out_time
         from public.attendance_sessions
         where attendance_record_id = (
           select id from public.attendance_records
           where employee_id = $1 and work_date = '2026-11-19'
         )`,
        [mathEmployee],
      )
    )[0]
    if (!session || session.in_time !== '08:15' || session.out_time !== '16:45') {
      throw new Error(`session=${JSON.stringify(session)}`)
    }

    const record = (
      await query(
        `select worked_minutes, late_minutes, undertime_minutes
         from public.attendance_records
         where employee_id = $1 and work_date = '2026-11-19'`,
        [mathEmployee],
      )
    )[0]
    if (record.worked_minutes !== 450 || record.undertime_minutes !== 30) {
      throw new Error(`record=${JSON.stringify(record)}`)
    }
    return 'single pair updated atomically, totals recomputed'
  })

  const rejected = JSON.parse(
    await asUser(mathProfile, () =>
      scalar(
        `select public.request_correction(
           '2026-11-17', 'missing_time_out', null, '2026-11-17T17:00:00+08',
           'Forgot to time out before going home.'
         )::text`,
      ),
    ),
  )

  await expectFailure(
    'rejecting a correction requires notes',
    /REVIEW_NOTES_REQUIRED/,
    () =>
      asUser(adminProfile, () =>
        query(`select public.review_correction($1::uuid, false, null)`, [rejected.id]),
      ),
  )

  await check('a rejected correction keeps the reviewer note', async () => {
    await asUser(adminProfile, () =>
      query(
        `select public.review_correction($1::uuid, false, 'No matching logbook entry.')`,
        [rejected.id],
      ),
    )
    const row = (
      await query(`select status, review_notes, reviewed_at from public.attendance_corrections where id = $1`, [
        rejected.id,
      ])
    )[0]
    if (row.status !== 'rejected' || !row.review_notes || !row.reviewed_at) {
      throw new Error('rejection not stored')
    }
    return 'rejected with notes'
  })

  await check('employees can cancel their own pending requests', async () => {
    const pending = JSON.parse(
      await asUser(mathProfile, () =>
        scalar(
          `select public.request_correction(
             '2026-11-16', 'incorrect_time', '2026-11-16T08:00:00+08',
             '2026-11-16T17:00:00+08', 'Both punches were entered on the wrong day.'
           )::text`,
        ),
      ),
    )
    await asUser(mathProfile, () =>
      query(`select public.cancel_correction($1::uuid)`, [pending.id]),
    )
    const status = await scalar(
      `select status from public.attendance_corrections where id = $1`,
      [pending.id],
    )
    if (status !== 'cancelled') throw new Error(`status=${status}`)
    return 'cancelled'
  })

  // -------------------------------------------------------------------------
  // Phase 10: audit trail viewer
  // -------------------------------------------------------------------------
  await check('list_audit_logs returns audited actions for admins', async () => {
    const page = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.list_audit_logs('correction', 1, 10)::text`),
      ),
    )
    if (page.total < 3) throw new Error(`total=${page.total}`)
    if (!page.items.every((item) => item.action.includes('correction'))) {
      throw new Error('search returned unrelated actions')
    }
    if (!page.items.some((item) => item.actor_name)) {
      throw new Error('actor names missing')
    }
    return `${page.total} correction entries with actor names`
  })

  await expectFailure(
    'employees cannot read the audit trail',
    /FORBIDDEN/,
    () => asUser(mathProfile, () => query(`select public.list_audit_logs()`)),
  )

  // -------------------------------------------------------------------------
  // Schedule-scoped administration views
  // -------------------------------------------------------------------------
  await check('admin_dashboard can be scoped to one schedule', async () => {
    const all = JSON.parse(
      await asUser(adminProfile, () => scalar(`select public.admin_dashboard(null, null)::text`)),
    )
    const scoped = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.admin_dashboard(null, $1::uuid)::text`, [allDay.id]),
      ),
    )
    const expected = await scalar(
      `select count(*)::int from public.employees e
       where e.status = 'active'
         and private.resolve_schedule(e.id, (now() at time zone 'Asia/Manila')::date) = $1`,
      [allDay.id],
    )
    if (scoped.schedule_id !== allDay.id) throw new Error('schedule id not echoed')
    if (scoped.total_employees !== expected) {
      throw new Error(`scoped=${scoped.total_employees} expected=${expected}`)
    }
    if (all.total_employees < scoped.total_employees) throw new Error('scope grew the total')
    if (scoped.trend.length !== 14) throw new Error('trend length changed')
    return `${scoped.total_employees} active in the selected schedule`
  })

  await check('list_attendance filters by the schedule in force', async () => {
    const start = '2026-11-01'
    const end = '2026-11-30'
    const all = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(
          `select public.list_attendance('${start}', '${end}', null, 1, 100, null)::text`,
        ),
      ),
    )
    const scoped = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(
          `select public.list_attendance('${start}', '${end}', null, 1, 100, $1::uuid)::text`,
          [allDay.id],
        ),
      ),
    )
    const expected = await scalar(
      `select count(*)::int from public.attendance_records r
       where r.work_date between $1 and $2
         and private.resolve_schedule(r.employee_id, r.work_date) = $3`,
      [start, end, allDay.id],
    )
    if (scoped.total !== expected) throw new Error(`scoped=${scoped.total} expected=${expected}`)
    if (scoped.total > all.total) throw new Error('filter returned more rows than unfiltered')
    if (!scoped.items.every((item) => item.work_date >= start && item.work_date <= end)) {
      throw new Error('rows escaped the period')
    }
    return `${scoped.total} of ${all.total} records in the selected schedule`
  })

  await check('list_corrections filters by the schedule in force', async () => {
    const request = JSON.parse(
      await asUser(mathProfile, () =>
        scalar(
          `select public.request_correction(
             '2026-11-15', 'missing_time_in', '2026-11-15T08:00:00+08', null,
             'Forgot to time in on this day.'
           )::text`,
        ),
      ),
    )

    const forMath = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.list_corrections('pending', 1, 100, $1::uuid)::text`, [schedule]),
      ),
    )
    const forOther = JSON.parse(
      await asUser(adminProfile, () =>
        scalar(`select public.list_corrections('pending', 1, 100, $1::uuid)::text`, [allDay.id]),
      ),
    )

    if (!forMath.items.some((item) => item.id === request.id)) {
      throw new Error('request missing from its own schedule')
    }
    if (forOther.items.some((item) => item.id === request.id)) {
      throw new Error('request appeared under another schedule')
    }

    await asUser(mathProfile, () =>
      query(`select public.cancel_correction($1::uuid)`, [request.id]),
    )
    return 'found on its schedule, absent from the other'
  })


  const failed = results.filter((result) => !result.ok)
  for (const result of results) {
    console.log(`${result.ok ? '  PASS' : '  FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`)

  await db.close()

  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`)
    process.exitCode = 1
  }
}

main().catch(async (error) => {
  console.error('\nHarness crashed:', error)
  try {
    await db?.close()
  } catch {
    /* ignore */
  }
  process.exitCode = 1
})
