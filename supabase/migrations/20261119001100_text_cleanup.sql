-- ===========================================================================
-- DTR Management System - Phase 6 text cleanup
--
-- The default schedule description was pasted through a Windows-1252 terminal,
-- which turned the en dashes into replacement characters. Normalize it to plain
-- ASCII so exports and PDFs stay readable.
-- ===========================================================================

begin;

update public.work_schedules
   set description = 'Monday to Friday, 8:00-12:00 and 13:00-17:00'
 where name = 'OJT Standard'
   and description is distinct from 'Monday to Friday, 8:00-12:00 and 13:00-17:00';

commit;
