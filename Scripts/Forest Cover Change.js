// ============================================================================
// 1. CONFIGURATION
// ============================================================================

var GFC_ASSET      = 'UMD/hansen/global_forest_change_2023_v1_11';
var LAST_YEAR_CODE = 23;   // 1 = 2001, so 23 = 2023

var TREE_COVER_THRESHOLD = 30;

var DISTRICTS = ['Rangamati', 'Khagrachhari', 'Bandarban'];

var VERIFY_DISTRICT_NAMES = false;   
var EXPORT_SCALE = 30;
var DRIVE_FOLDER = 'cht_forest_change';


var LOSS_BANDS = [];
for (var i = 1; i <= LAST_YEAR_CODE; i++) {
  LOSS_BANDS.push('loss_' + (2000 + i));
}

// ============================================================================
// 2. STUDY AREA
// ============================================================================

var gaul = ee.FeatureCollection('FAO/GAUL/2015/level2');
var bangladesh = gaul.filter(ee.Filter.eq('ADM0_NAME', 'Bangladesh'));

if (VERIFY_DISTRICT_NAMES) {
  print('--- ADM2 names in Bangladesh ---',
        bangladesh.aggregate_array('ADM2_NAME').sort());
}

var districts = bangladesh
  .filter(ee.Filter.inList('ADM2_NAME', DISTRICTS))
  .select(['ADM2_NAME']);

var cht = districts.union().first().geometry();

print('Districts matched (should be 3):', districts.size());
Map.centerObject(cht, 8);

// ============================================================================
// 3. SOURCE DATA
// ============================================================================

var gfc       = ee.Image(GFC_ASSET).clip(cht);
var treeCover = gfc.select('treecover2000');
var lossYear  = gfc.select('lossyear');
var gain      = gfc.select('gain');
var datamask  = gfc.select('datamask').eq(1);   // 1 = land, 2 = permanent water

var forest2000 = treeCover.gte(TREE_COVER_THRESHOLD).and(datamask);

var srtm  = ee.Image('USGS/SRTMGL1_003').clip(cht);
var slope = ee.Terrain.slope(srtm);

var areaHa = ee.Image.pixelArea().divide(10000);

// ============================================================================
// 4. BASELINE FOREST AREA (2000)
// ============================================================================

var baselineByDistrict = forest2000.multiply(areaHa)
  .reduceRegions({
    collection: districts,
    reducer: ee.Reducer.sum().setOutputs(['forest_2000_ha']),
    scale: EXPORT_SCALE,
    tileScale: 4
  });

print('Baseline forest area 2000 (ha), threshold ' + TREE_COVER_THRESHOLD + '%:',
      baselineByDistrict);

// ============================================================================
// 5. ANNUAL LOSS
// ============================================================================

var yearBands = [];
for (var y = 1; y <= LAST_YEAR_CODE; y++) {
  yearBands.push(
    lossYear.eq(y).and(forest2000).multiply(areaHa).rename(LOSS_BANDS[y - 1])
  );
}
var lossStack = ee.Image.cat(yearBands);


var annualLoss = lossStack.reduceRegions({
  collection: districts,
  reducer: ee.Reducer.sum(),
  scale: EXPORT_SCALE,
  tileScale: 4
});

Export.table.toDrive({
  collection: annualLoss,
  description: 'cht_annual_loss_by_district',
  folder: DRIVE_FOLDER,
  fileFormat: 'CSV',
  selectors: ['ADM2_NAME'].concat(LOSS_BANDS)
});


print(ui.Chart.feature.byFeature(annualLoss, 'ADM2_NAME', LOSS_BANDS)
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Annual forest loss by district (ha), >=' +
           TREE_COVER_THRESHOLD + '% canopy',
    hAxis: {title: 'District'},
    vAxis: {title: 'Hectares'},
    isStacked: true
  }));


var lossByYear = ee.FeatureCollection(LOSS_BANDS.map(function (band, idx) {
  return ee.Feature(null, {
    year: 2001 + idx,
    loss_ha: lossStack.select(band).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: cht,
      scale: EXPORT_SCALE,
      maxPixels: 1e10,
      tileScale: 4
    }).get(band)
  });
}));

print(ui.Chart.feature.byFeature(lossByYear, 'year', ['loss_ha'])
  .setChartType('LineChart')
  .setOptions({
    title: 'Annual forest loss, CHT total (ha)',
    hAxis: {title: 'Year', format: '####'},
    vAxis: {title: 'Hectares'},
    legend: {position: 'none'}
  }));

Export.table.toDrive({
  collection: lossByYear,
  description: 'cht_annual_loss_total',
  folder: DRIVE_FOLDER,
  fileFormat: 'CSV',
  selectors: ['year', 'loss_ha']
});

// ============================================================================
// 6. TOTALS AND GAIN
// ============================================================================

var totalLoss = lossYear.gt(0).and(forest2000).multiply(areaHa)
  .rename('total_loss_ha');
var totalGain = gain.eq(1).and(datamask).multiply(areaHa)
  .rename('total_gain_ha');

print('Total loss / gain by district (ha):',
  totalLoss.addBands(totalGain).reduceRegions({
    collection: districts,
    reducer: ee.Reducer.sum(),
    scale: EXPORT_SCALE,
    tileScale: 4
  }));


// ============================================================================
// 7. STRATIFICATION BY TERRAIN
// ============================================================================

var elevBands  = [0, 100, 300, 600, 1000, 9999];
var slopeBands = [0, 5, 15, 30, 90];

function sumHa(mask) {
  return mask.multiply(areaHa).rename('ha').reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: cht,
    scale: EXPORT_SCALE,
    maxPixels: 1e10,
    tileScale: 4
  }).get('ha');
}

function stratify(source, breaks, label) {
  var rows = [];
  for (var j = 0; j < breaks.length - 1; j++) {
    var lo = breaks[j], hi = breaks[j + 1];
    var inBand = source.gte(lo).and(source.lt(hi));
    var baseline = sumHa(forest2000.and(inBand));
    var lost     = sumHa(lossYear.gt(0).and(forest2000).and(inBand));
    rows.push(ee.Feature(null, {
      stratum: label,
      band: lo + '-' + hi,
      forest_2000_ha: baseline,
      loss_ha: lost,
      loss_pct_of_baseline: ee.Number(lost).divide(ee.Number(baseline))
                              .multiply(100)
    }));
  }
  return ee.FeatureCollection(rows);
}

var strata = stratify(srtm, elevBands, 'elevation_m')
  .merge(stratify(slope, slopeBands, 'slope_deg'));

print('Loss by terrain stratum:', strata);

Export.table.toDrive({
  collection: strata,
  description: 'cht_loss_by_terrain',
  folder: DRIVE_FOLDER,
  fileFormat: 'CSV',
  selectors: ['stratum', 'band', 'forest_2000_ha', 'loss_ha',
              'loss_pct_of_baseline']
});

// ============================================================================
// 8. MAP LAYERS
// ============================================================================

Map.addLayer(cht, {color: '000000'}, 'CHT boundary', true, 0.4);
Map.addLayer(forest2000.selfMask(), {palette: ['1B5E3F']},
             'Forest 2000 (>=' + TREE_COVER_THRESHOLD + '%)');
Map.addLayer(lossYear.updateMask(lossYear.gt(0).and(forest2000)),
  {min: 1, max: LAST_YEAR_CODE,
   palette: ['fde725', 'fca50a', 'dd513a', '932667', '420a68']},
  'Loss year (light = early, dark = recent)');
Map.addLayer(gain.selfMask(), {palette: ['4FC3F7']}, 'Gain 2000-2012', false);

// ============================================================================
// 9. GEOTIFF EXPORT
// ============================================================================

Export.image.toDrive({
  image: lossYear.updateMask(lossYear.gt(0).and(forest2000)).toInt16(),
  description: 'cht_loss_year',
  folder: DRIVE_FOLDER,
  region: cht,
  scale: EXPORT_SCALE,
  crs: 'EPSG:32646',          
  maxPixels: 1e10
});