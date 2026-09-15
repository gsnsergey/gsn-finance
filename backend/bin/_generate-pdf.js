// Утилита для bin/test-import-flow.sh: генерирует PDF из текста через pdfkit.
// Использование: generatePdf.js <output.pdf>
//
// Текст читается из переменной TEXT (через env), формат — те же логические
// строки выписки, что и в alfa.test.js (3 строки на операцию).
//
// Шрифт: стандартный Helvetica в pdfkit использует WinAnsi, который НЕ
// поддерживает кириллицу — кириллический текст в PDF превращается в мусор
// при извлечении. Поэтому подключаем TTF с Unicode (Arial Unicode из системной
// папки macOS или DejaVu через node_modules). Если шрифт не найден — тест
// использует латиницу и фолбэк на Helvetica с предупреждением.

import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'

const out = process.argv[2]
if (!out) {
  process.stderr.write('usage: _generate-pdf.js <output.pdf>\n')
  process.exit(1)
}

const text = process.env.TEXT || ''

// Ищем TTF с поддержкой Unicode: предпочитаем системные шрифты macOS,
// фолбэк — DejaVu из node_modules.
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/System/Library/Fonts/HelveticaNeue.ttc',
  path.resolve(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf')
]

let unicodeFont = null
for (const p of FONT_CANDIDATES) {
  if (fs.existsSync(p)) { unicodeFont = p; break }
}

const doc = new PDFDocument({ size: 'A4', margin: 40 })
const stream = fs.createWriteStream(out)
doc.pipe(stream)

if (unicodeFont) {
  doc.registerFont('Unicode', unicodeFont)
  doc.font('Unicode').fontSize(8)
} else {
  process.stderr.write('[warn] Unicode TTF не найден — кириллица не извлечётся. Использую Helvetica.\n')
  doc.font('Courier').fontSize(8)
}

for (const line of text.split('\n')) {
  doc.text(line)
}

doc.end()
stream.on('finish', () => process.exit(0))
stream.on('error', e => { process.stderr.write(`${e.message}\n`); process.exit(1) })