// Google Apps Script — Web App proxy for Questions form
// Spreadsheet ID: 13wdUR3-Hpm9Fx5RWQym2ZLxUMRalmbtFkzwyt8_Pw1s
//
// DEPLOYMENT INSTRUCTIONS:
// 1. Open the Google Sheet
// 2. Extensions > Apps Script
// 3. Paste this entire file, replacing any existing code
// 4. Click "Save" (floppy disk icon)
// 5. Click "Deploy" > "New deployment"
// 6. Type: "Web app"
// 7. Execute as: "Me"
// 8. Who has access: "Anyone"
// 9. Click "Deploy" and authorize when prompted
// 10. Copy the Web App URL (looks like: https://script.google.com/macros/s/AKfycb.../exec)
// 11. In index.html, replace the APPS_SCRIPT_URL placeholder with that URL

var SPREADSHEET_ID = '13wdUR3-Hpm9Fx5RWQym2ZLxUMRalmbtFkzwyt8_Pw1s';
var SHEET_NAME = 'Sheet1'; // Change if your sheet tab has a different name

function doPost(e) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

    // Ensure headers exist in row 1
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Дата/время', 'Имя', 'Email', 'Вопрос']);
    }

    // Parse POST data
    var params = e.parameter;
    var datetime = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Novosibirsk' });
    var name = params.name || '';
    var email = params.email || '';
    var question = params.question || '';

    // Append new row
    sheet.appendRow([datetime, name, email, question]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Handle CORS preflight (OPTIONS)
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Questions endpoint active' }))
    .setMimeType(ContentService.MimeType.JSON);
}
