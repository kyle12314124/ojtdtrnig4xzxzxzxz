import { formatInTimeZone } from 'date-fns-tz'
import { env } from '@/lib/env'
import { formatDateOnly, formatTime } from '@/lib/dates'
import { formatMinutes } from '@/lib/utils'
import type { DtrPayload, DtrRow } from '@/types'

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function fileStamp(dtr: DtrPayload): string {
  const safeName = dtr.employee.full_name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return `DTR-${safeName || 'employee'}-${dtr.period.start}-to-${dtr.period.end}`
}

function weekdayLabel(dayKey: string): string {
  return formatInTimeZone(new Date(`${dayKey}T12:00:00Z`), 'UTC', 'EEE')
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function timeList(row: DtrRow, key: 'time_in' | 'time_out'): string {
  const values = row.sessions
    .map((session) => (key === 'time_in' ? session.time_in : session.time_out))
    .filter(Boolean)
    .map((value) => formatTime(value))
  return values.length > 0 ? values.join(' | ') : ''
}

function statusLabel(row: DtrRow): string {
  if (row.holiday) return 'Holiday'
  if (!row.record) return row.is_work_day ? 'Absent' : 'Rest day'
  return row.record.status.replace('_', ' ')
}

function workedMinutes(row: DtrRow): number {
  return row.record?.worked_minutes ?? 0
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function exportDtrCsv(dtr: DtrPayload) {
  const header = [
    'Date',
    'Day',
    'Time In',
    'Time Out',
    'Worked (minutes)',
    'Late (minutes)',
    'Undertime (minutes)',
    'Overtime (minutes)',
    'Status',
  ]

  const lines = dtr.rows.map((row) =>
    [
      row.work_date,
      weekdayLabel(row.work_date),
      timeList(row, 'time_in'),
      timeList(row, 'time_out'),
      workedMinutes(row),
      row.record?.late_minutes ?? 0,
      row.record?.undertime_minutes ?? 0,
      row.record?.overtime_minutes ?? 0,
      statusLabel(row),
    ]
      .map(csvCell)
      .join(','),
  )

  const totals = [
    'TOTAL',
    '',
    '',
    '',
    dtr.totals.worked_minutes,
    dtr.totals.late_minutes,
    dtr.totals.undertime_minutes,
    dtr.totals.overtime_minutes,
    `${dtr.totals.days_present} day(s) present`,
  ]
    .map(csvCell)
    .join(',')

  const meta = [
    `Employee,${csvCell(dtr.employee.full_name)}`,
    `Employee no.,${csvCell(dtr.employee.employee_no)}`,
    `Department,${csvCell(dtr.employee.department ?? '')}`,
    `Position,${csvCell(dtr.employee.position ?? '')}`,
    `Schedule,${csvCell(dtr.employee.schedule ?? '')}`,
    `Period,${csvCell(dtr.period.label)}`,
    '',
  ]

  const content = [...meta, header.join(','), ...lines, totals].join('\r\n')
  download(
    new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }),
    `${fileStamp(dtr)}.csv`,
  )
}

/* -------------------------------------------------------------------------- */
/* Excel                                                                       */
/* -------------------------------------------------------------------------- */

export async function exportDtrExcel(dtr: DtrPayload) {
  const { Workbook } = await import('exceljs')
  const workbook = new Workbook()
  workbook.creator = env.orgName
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('DTR', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  })

  sheet.columns = [
    { width: 13 },
    { width: 7 },
    { width: 11 },
    { width: 11 },
    { width: 11 },
    { width: 8 },
    { width: 11 },
    { width: 13 },
  ]

  sheet.mergeCells('A1:H1')
  const title = sheet.getCell('A1')
  title.value = env.orgName
  title.font = { bold: true, size: 14 }
  title.alignment = { horizontal: 'center' }

  sheet.mergeCells('A2:H2')
  const subtitle = sheet.getCell('A2')
  subtitle.value = 'DAILY TIME RECORD'
  subtitle.font = { bold: true, size: 12 }
  subtitle.alignment = { horizontal: 'center' }

  if (env.orgAddress) {
    sheet.mergeCells('A3:H3')
    const address = sheet.getCell('A3')
    address.value = env.orgAddress
    address.font = { size: 10, color: { argb: 'FF6B7280' } }
    address.alignment = { horizontal: 'center' }
  }

  const info: Array<[string, string]> = [
    ['Employee', dtr.employee.full_name],
    ['Employee no.', dtr.employee.employee_no],
    ['Department', dtr.employee.department ?? '—'],
    ['Position', dtr.employee.position ?? '—'],
    ['Schedule', dtr.employee.schedule ?? '—'],
    ['Period', dtr.period.label],
  ]

  info.forEach(([label, value], index) => {
    const row = sheet.getRow(5 + index)
    row.getCell(1).value = label
    row.getCell(1).font = { bold: true }
    row.getCell(2).value = value
    sheet.mergeCells(`B${5 + index}:D${5 + index}`)
  })

  const headerRow = sheet.getRow(12)
  headerRow.values = [
    'Date',
    'Day',
    'Time In',
    'Time Out',
    'Worked',
    'Late',
    'Undertime',
    'Overtime',
  ]
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3F6212' } }
    cell.alignment = { horizontal: 'center' }
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    }
  })

  dtr.rows.forEach((row, index) => {
    const target = sheet.getRow(13 + index)
    target.values = [
      formatDateOnly(row.work_date),
      weekdayLabel(row.work_date),
      timeList(row, 'time_in') || '—',
      timeList(row, 'time_out') || '—',
      formatMinutes(workedMinutes(row)),
      formatMinutes(row.record?.late_minutes ?? 0),
      formatMinutes(row.record?.undertime_minutes ?? 0),
      formatMinutes(row.record?.overtime_minutes ?? 0),
    ]
    target.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      }
    })
  })

  const totalRow = sheet.getRow(13 + dtr.rows.length)
  totalRow.values = [
    'TOTAL',
    '',
    '',
    '',
    formatMinutes(dtr.totals.worked_minutes),
    formatMinutes(dtr.totals.late_minutes),
    formatMinutes(dtr.totals.undertime_minutes),
    formatMinutes(dtr.totals.overtime_minutes),
  ]
  totalRow.font = { bold: true }

  const signatureTop = 16 + dtr.rows.length
  sheet.getCell(`A${signatureTop}`).value = 'Employee signature'
  sheet.getCell(`E${signatureTop}`).value = 'Reviewed by'
  sheet.getCell(`A${signatureTop + 3}`).value = '____________________________'
  sheet.getCell(`E${signatureTop + 3}`).value = '____________________________'

  const buffer = await workbook.xlsx.writeBuffer()
  download(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${fileStamp(dtr)}.xlsx`,
  )
}

/* -------------------------------------------------------------------------- */
/* PDF (A4, printable)                                                         */
/* -------------------------------------------------------------------------- */

export async function exportDtrPdf(dtr: DtrPayload) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(env.orgName, pageWidth / 2, 44, { align: 'center' })

  if (env.orgAddress) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(107, 114, 128)
    doc.text(env.orgAddress, pageWidth / 2, 58, { align: 'center' })
  }

  doc.setTextColor(17, 24, 39)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('DAILY TIME RECORD', pageWidth / 2, 80, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(55, 65, 81)

  const infoLines = [
    `Employee: ${dtr.employee.full_name}`,
    `Employee no.: ${dtr.employee.employee_no}`,
    `Department: ${dtr.employee.department ?? '—'}`,
    `Position: ${dtr.employee.position ?? '—'}`,
  ]
  infoLines.forEach((line, index) => doc.text(line, margin, 102 + index * 13))

  doc.text(`Schedule: ${dtr.employee.schedule ?? '—'}`, pageWidth - margin, 102, {
    align: 'right',
  })
  doc.text(`Period: ${dtr.period.label}`, pageWidth - margin, 115, { align: 'right' })

  autoTable(doc, {
    startY: 160,
    margin: { left: margin, right: margin },
    head: [['Date', 'Day', 'Time in', 'Time out', 'Worked', 'Late', 'Under', 'Over', 'Status']],
    body: dtr.rows.map((row) => [
      formatDateOnly(row.work_date),
      weekdayLabel(row.work_date),
      timeList(row, 'time_in') || '—',
      timeList(row, 'time_out') || '—',
      formatMinutes(workedMinutes(row)),
      formatMinutes(row.record?.late_minutes ?? 0),
      formatMinutes(row.record?.undertime_minutes ?? 0),
      formatMinutes(row.record?.overtime_minutes ?? 0),
      statusLabel(row),
    ]),
    foot: [
      [
        'TOTAL',
        '',
        '',
        '',
        formatMinutes(dtr.totals.worked_minutes),
        formatMinutes(dtr.totals.late_minutes),
        formatMinutes(dtr.totals.undertime_minutes),
        formatMinutes(dtr.totals.overtime_minutes),
        `${dtr.totals.days_present} day(s)`,
      ],
    ],
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [63, 98, 18], textColor: 255, halign: 'center' },
    footStyles: { fillColor: [243, 244, 246], textColor: 17, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 32, halign: 'center' },
      2: { cellWidth: 78 },
      3: { cellWidth: 78 },
      4: { cellWidth: 48, halign: 'right' },
      5: { cellWidth: 40, halign: 'right' },
      6: { cellWidth: 44, halign: 'right' },
      7: { cellWidth: 42, halign: 'right' },
      8: { cellWidth: 52 },
    },
    didDrawPage: () => {
      doc.setFontSize(8)
      doc.setTextColor(107, 114, 128)
      doc.text(
        `Generated ${formatDateOnly(new Date().toISOString().slice(0, 10))} · ${env.appName}`,
        margin,
        doc.internal.pageSize.getHeight() - 22,
      )
      doc.text(
        `Page ${doc.getNumberOfPages()}`,
        pageWidth - margin,
        doc.internal.pageSize.getHeight() - 22,
        { align: 'right' },
      )
    },
  })

  type WithAutoTable = { lastAutoTable?: { finalY: number } }
  const finalY = (doc as unknown as WithAutoTable).lastAutoTable?.finalY ?? 500
  const signatureY = Math.min(finalY + 52, doc.internal.pageSize.getHeight() - 110)

  doc.setDrawColor(156, 163, 175)
  doc.setFontSize(9)
  doc.setTextColor(55, 65, 81)

  const signatureSlots = [
    { x: margin + 40, label: 'Employee signature' },
    { x: pageWidth / 2 - 60, label: 'Reviewed by' },
    { x: pageWidth - margin - 150, label: 'Approved by' },
  ]

  signatureSlots.forEach((slot) => {
    doc.line(slot.x, signatureY, slot.x + 150, signatureY)
    doc.text(slot.label, slot.x + 75, signatureY + 14, { align: 'center' })
  })

  doc.save(`${fileStamp(dtr)}.pdf`)
}
