import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const REAL_SHEETS = new Map([
  ['Resumen clientes', 10],
  ['Detalle créditos', 3],
  ['Historial pagos', 3],
]);

async function loadWorkbook(bytes) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch (error) {
    const zip = await JSZip.loadAsync(bytes);
    let changed = false;
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !name.endsWith('.xml')) continue;
      const xml = await entry.async('string');
      if (!xml.includes('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) continue;
      zip.file(name, xml.replaceAll('<x:', '<').replaceAll('</x:', '</').replace('xmlns:x=', 'xmlns='));
      changed = true;
    }
    if (!changed) throw error;
    await workbook.xlsx.load(await zip.generateAsync({ type: 'nodebuffer' }), { ignoreNodes: ['tableParts'] });
  }
  return workbook;
}

export async function readWorkbookSheets(bytes) {
  const workbook = await loadWorkbook(bytes);
  const sheets = {};
  workbook.eachSheet((sheet) => {
    const headerRow = REAL_SHEETS.get(sheet.name) ?? 1;
    const headers = sheet.getRow(headerRow).values.slice(1).map((value) => String(value ?? '').trim());
    const records = [];
    sheet.eachRow((row, number) => {
      if (number <= headerRow) return;
      const record = {};
      headers.forEach((header, index) => { if (header) record[header] = row.getCell(index + 1).value ?? ''; });
      if (Object.values(record).some((value) => value !== '')) records.push(record);
    });
    records.headerRow = headerRow;
    sheets[sheet.name] = records;
  });
  return sheets;
}
