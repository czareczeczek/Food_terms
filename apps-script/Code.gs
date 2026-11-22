/* Deploy this web app as the accessing user. OAuth tokens stay on this server. */
var PANTRY_FILE_NAME_ = 'straznik-swiezosci.json';
var PANTRY_MAX_BYTES_ = 2 * 1024 * 1024;
var PANTRY_MAX_PRODUCTS_ = 10000;
var PANTRY_CATEGORIES_ = ['Nabiał', 'Mięso i ryby', 'Warzywa', 'Owoce', 'Pieczywo', 'Produkty suche', 'Mrożonki', 'Napoje', 'Inne'];
var PANTRY_LOCATIONS_ = ['Lodówka', 'Zamrażarka', 'Szafka', 'Spiżarnia', 'Inne'];
var PANTRY_UNITS_ = ['szt.', 'g', 'kg', 'ml', 'l', 'opak.'];
var PANTRY_UUID_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Strażnik świeżości').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getPantryState() {
  try {
    return pantryLocked_(function () { return pantryRead_(pantryAccountKey_()).state; });
  } catch (error) {
    throw new Error(error && error.pantrySafe_ ? error.message : 'Nie udało się odczytać danych z Dysku Google. Sprawdź dostęp i spróbuj ponownie.');
  }
}

function savePantryState(payload) {
  var writeStarted = false;
  try {
    return pantryLocked_(function () {
      if (!pantryRecord_(payload) || !pantryRevisionInput_(payload.expectedRevision) || typeof payload.expectedAccountKey !== 'string' || !payload.expectedAccountKey.trim() || payload.expectedAccountKey.length > 1024) {
        throw pantryError_('Nieprawidłowy stan synchronizacji. Odczytaj ponownie dane z Dysku Google.');
      }
      var validatedProducts = pantryValidateProducts_(payload.products);
      var accountKey = pantryAccountKey_();
      var current = pantryRead_(accountKey);
      if (payload.expectedAccountKey !== accountKey || payload.expectedRevision !== current.state.revision) {
        return { ok: false, conflict: true, state: current.state };
      }
      var next = {
        version: 1,
        revision: Utilities.getUuid(),
        modifiedAt: new Date().toISOString(),
        products: validatedProducts
      };
      if (!PANTRY_UUID_.test(next.revision)) throw pantryError_('Nie udało się przygotować zapisu na Dysku Google.');
      var json = JSON.stringify(next);
      pantryCheckSize_(json);
      var blob = Utilities.newBlob(json, 'application/json', PANTRY_FILE_NAME_);
      var metadata;
      writeStarted = true;
      if (current.fileId === null) {
        metadata = Drive.Files.create({ name: PANTRY_FILE_NAME_, mimeType: 'application/json', parents: ['appDataFolder'] }, blob, { fields: 'id,name,mimeType,size,modifiedTime' });
      } else {
        metadata = Drive.Files.update({ mimeType: 'application/json' }, current.fileId, blob, { fields: 'id,name,mimeType,size,modifiedTime' });
      }
      pantryValidateMetadata_(metadata);
      if (current.fileId !== null && metadata.id !== current.fileId) throw new Error('Unexpected file identifier');
      return { ok: true, state: { accountKey: accountKey, revision: next.revision, products: next.products, modifiedAt: next.modifiedAt } };
    });
  } catch (error) {
    if (!writeStarted && error && error.pantrySafe_) throw new Error(error.message);
    throw new Error('Nie udało się potwierdzić zapisu na Dysku Google. Odczytaj ponownie stan przed kolejną próbą.');
  }
}

function pantryLocked_(operation) {
  var lock = LockService.getUserLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(10000);
    if (!acquired) throw pantryError_('Dane są właśnie synchronizowane. Spróbuj ponownie za chwilę.');
    return operation();
  } finally {
    if (acquired) lock.releaseLock();
  }
}

function pantryAccountKey_() {
  var properties = PropertiesService.getUserProperties();
  var id = properties.getProperty('PANTRY_ACCOUNT_ID_V1');
  if (id === null) {
    id = Utilities.getUuid();
    if (!PANTRY_UUID_.test(id)) throw new Error('Invalid generated identity');
    properties.setProperty('PANTRY_ACCOUNT_ID_V1', id);
  }
  var scriptId = ScriptApp.getScriptId();
  if (typeof id !== 'string' || !PANTRY_UUID_.test(id) || typeof scriptId !== 'string' || !scriptId.trim()) throw new Error('Invalid account identity');
  return scriptId + ':' + id;
}

function pantryRead_(accountKey) {
  var result = Drive.Files.list({
    spaces: 'appDataFolder',
    q: "name = 'straznik-swiezosci.json' and trashed = false",
    pageSize: 100,
    fields: 'files(id,name,mimeType,size,modifiedTime),nextPageToken'
  });
  if (!pantryRecord_(result)) throw pantryCorrupt_();
  if (result.nextPageToken !== undefined && result.nextPageToken !== '') throw pantryCorrupt_();
  var files = result.files === undefined ? [] : result.files;
  if (!Array.isArray(files) || files.length > 1) throw pantryCorrupt_();
  if (files.length === 0) return { fileId: null, state: { accountKey: accountKey, revision: null, products: [], modifiedAt: null } };
  var file = files[0];
  pantryValidateMetadata_(file);
  var response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
    validateHttpsCertificates: true,
    followRedirects: false
  });
  if (response.getResponseCode() !== 200) throw new Error('Media read failed');
  var json = response.getContentText('UTF-8');
  if (typeof json !== 'string') throw pantryCorrupt_();
  pantryCheckSize_(json);
  var data;
  try { data = JSON.parse(json); } catch (error) { throw pantryCorrupt_(); }
  if (!pantryRecord_(data) || data.version !== 1 || typeof data.revision !== 'string' || !PANTRY_UUID_.test(data.revision) || !pantryTimestamp_(data.modifiedAt)) throw pantryCorrupt_();
  var products;
  try { products = pantryValidateProducts_(data.products); } catch (error) { throw pantryCorrupt_(); }
  return { fileId: file.id, state: { accountKey: accountKey, revision: data.revision, products: products, modifiedAt: data.modifiedAt } };
}

function pantryValidateMetadata_(file) {
  if (!pantryRecord_(file) || typeof file.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(file.id) || file.name !== PANTRY_FILE_NAME_ || file.mimeType !== 'application/json' || typeof file.size !== 'string' || !/^\d+$/.test(file.size) || !Number.isSafeInteger(Number(file.size)) || Number(file.size) > PANTRY_MAX_BYTES_ || !pantryDriveTimestamp_(file.modifiedTime)) {
    throw pantryCorrupt_();
  }
}

function pantryCheckSize_(json) {
  if (Utilities.newBlob(json).getBytes().length > PANTRY_MAX_BYTES_) throw pantryError_('Dane przekraczają limit 2 MB. Plik na Dysku Google nie został zastąpiony.');
}

function pantryValidateProducts_(products) {
  if (!Array.isArray(products) || products.length > PANTRY_MAX_PRODUCTS_) throw pantryInvalid_();
  var ids = Object.create(null);
  return products.map(function (product) {
    if (!pantryRecord_(product) || typeof product.id !== 'string' || !product.id.trim() || product.id.length > 100 || ids[product.id] || typeof product.name !== 'string' || !product.name.trim() || product.name.length > 200 || !pantryDay_(product.expiryDate) || !pantryDay_(product.openedDate) || ['useBy', 'bestBefore'].indexOf(product.dateLabel) < 0 || PANTRY_CATEGORIES_.indexOf(product.category) < 0 || PANTRY_LOCATIONS_.indexOf(product.location) < 0 || PANTRY_UNITS_.indexOf(product.unit) < 0 || typeof product.quantity !== 'number' || !Number.isFinite(product.quantity) || product.quantity < 0.000001 || product.quantity > 1e9 || pantryDecimals_(product.quantity) > 6 || typeof product.note !== 'string' || product.note.length > 2000 || ['active', 'used', 'discarded'].indexOf(product.state) < 0) throw pantryInvalid_();
    ids[product.id] = true;
    if (product.state === 'active' ? product.archivedAt !== null : !pantryTimestamp_(product.archivedAt)) throw pantryInvalid_();
    var result = {
      id: product.id, name: product.name, expiryDate: product.expiryDate, dateLabel: product.dateLabel,
      category: product.category, location: product.location, quantity: product.quantity, unit: product.unit,
      openedDate: product.openedDate, note: product.note, state: product.state, archivedAt: product.archivedAt
    };
    if (Object.prototype.hasOwnProperty.call(product, 'barcode')) {
      if (product.barcode !== '' && !pantryBarcode_(product.barcode)) throw pantryInvalid_();
      result.barcode = product.barcode;
    }
    if (Object.prototype.hasOwnProperty.call(product, 'nutrition')) result.nutrition = pantryValidateNutrition_(product.nutrition);
    return result;
  });
}

function pantryValidateNutrition_(nutrition) {
  if (!pantryRecord_(nutrition) || ['100g', '100ml'].indexOf(nutrition.basis) < 0 || ['manual', 'openfoodfacts'].indexOf(nutrition.source) < 0) throw pantryInvalid_();
  ['kcal', 'protein', 'fat', 'carbs'].forEach(function (field) {
    var number = nutrition[field];
    var limit = field === 'kcal' || nutrition.basis === '100ml' ? 1000 : 100;
    if (number !== null && (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > limit || pantryDecimals_(number) > 6)) throw pantryInvalid_();
  });
  var result = { basis: nutrition.basis, kcal: nutrition.kcal, protein: nutrition.protein, fat: nutrition.fat, carbs: nutrition.carbs, source: nutrition.source };
  if (Object.prototype.hasOwnProperty.call(nutrition, 'sourceBarcode')) {
    if (!pantryBarcode_(nutrition.sourceBarcode)) throw pantryInvalid_();
    result.sourceBarcode = nutrition.sourceBarcode;
  }
  if (nutrition.source === 'openfoodfacts' && !pantryBarcode_(nutrition.sourceBarcode)) throw pantryInvalid_();
  return result;
}

function pantryDecimals_(value) {
  var parts = String(value).toLowerCase().split('e');
  return Math.max(0, (parts[0].split('.')[1] || '').length - Number(parts[1] || 0));
}

function pantryDay_(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  var date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function pantryTimestamp_(value) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  var date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function pantryDriveTimestamp_(value) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  var normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, function (_, fraction) { return '.' + ((fraction || '') + '000').slice(0, 3) + 'Z'; });
  return pantryTimestamp_(normalized);
}

function pantryBarcode_(value) { return typeof value === 'string' && /^\d{8,14}$/.test(value); }
function pantryRevisionInput_(value) { return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 256); }
function pantryRecord_(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function pantryError_(message) { var error = new Error(message); error.pantrySafe_ = true; return error; }
function pantryInvalid_() { return pantryError_('Dane produktów są nieprawidłowe. Popraw je przed zapisem na Dysku Google.'); }
function pantryCorrupt_() { return pantryError_('Plik danych na Dysku Google jest nieprawidłowy lub niejednoznaczny. Nie został zastąpiony.'); }
