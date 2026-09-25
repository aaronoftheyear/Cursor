import { formatDoctorReport, runDoctor } from '../server/agentActivity/doctor.ts'

const projectRoot = process.argv[2] || process.cwd()
const dashboardUrl = process.argv[3] || 'http://127.0.0.1:5173'

const report = runDoctor(projectRoot, dashboardUrl)
console.log(formatDoctorReport(report))
const failed = report.lines.some((l) => !l.ok)
process.exit(failed ? 1 : 0)
