// ============================================================================
// 1. CONFIGURATION
// ============================================================================

var RUN_PART_A = false;
var RUN_PART_B = true;

var GFC_ASSET = 'UMD/hansen/global_forest_change_2023_v1_11';
var TREE_COVER_THRESHOLD = 30;
var DISTRICTS = ['Rangamati', 'Khagrachhari', 'Bandarban'];
var DRIVE_FOLDER = 'cht_forest_change';

var COHORTS = [2014, 2015, 2016, 2017, 2018];
var FIRST_YEAR = 2013;
var LAST_YEAR  = 2023;

var ANALYSIS_SCALE = 120;
var MAP_SCALE = 30;

// PART B only. Run at 0.80 / 0.85 / 0.90 / 0.95.
var RECOVERY_RATIO = 0.95;
var MAP_COHORT = 2018;

// ============================================================================
// 2. STUDY AREA AND FOREST BASELINE
// ============================================================================

var districts = ee.FeatureCollection('FAO/GAUL/2015/level2')
  .filter(ee.Filter.eq('ADM0_NAME', 'Bangladesh'))
  .filter(ee.Filter.inList('ADM2_NAME', DISTRICTS))
  .select(['ADM2_NAME']);

var cht = districts.union().first().geometry();

var gfc        = ee.Image(GFC_ASSET).clip(cht);
var lossYear   = gfc.select('lossyear');
var datamask   = gfc.select('datamask').eq(1);
var forest2000 = gfc.select('treecover2000').gte(TREE_COVER_THRESHOLD)
                    .and(datamask);


var intact = forest2000.and(lossYear.eq(0));

Map.centerObject(cht, 8);

// ============================================================================
// 3. ANNUAL DRY-SEASON NDVI
// ============================================================================

var landsat = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
  .filterBounds(cht);

function maskAndNdvi(img) {
  var qa = img.select('QA_PIXEL');
  var clear = qa.bitwiseAnd(1 << 1).eq(0)      // dilated cloud
    .and(qa.bitwiseAnd(1 << 2).eq(0))          // cirrus
    .and(qa.bitwiseAnd(1 << 3).eq(0))          // cloud
    .and(qa.bitwiseAnd(1 << 4).eq(0));         // cloud shadow
  var sr = img.select(['SR_B4', 'SR_B5'])
    .multiply(0.0000275).add(-0.2);            // C2 L2 scale and offset
  return sr.updateMask(clear)
    .normalizedDifference(['SR_B5', 'SR_B4'])
    .rename('ndvi');
}


function ndviYear(year) {
  return landsat
    .filterDate(ee.Date.fromYMD(year, 11, 15), ee.Date.fromYMD(year + 1, 3, 15))
    .map(maskAndNdvi)
    .median()
    .rename('ndvi');
}

// ============================================================================
// PART A — NDVI TRAJECTORY
// ============================================================================

if (RUN_PART_A) {

  
  function yearStats(year) {
    var ndvi = ndviYear(year);

    var bands = [ndvi.updateMask(intact).rename('intact')];
    for (var i = 0; i < COHORTS.length; i++) {
      bands.push(
        ndvi.updateMask(lossYear.eq(COHORTS[i] - 2000).and(forest2000))
            .rename('c' + COHORTS[i])
      );
    }

    
    var stats = ee.Image.cat(bands).reduceRegion({
      reducer: ee.Reducer.mean().combine({
        reducer2: ee.Reducer.count(), sharedInputs: true
      }),
      geometry: cht,
      scale: ANALYSIS_SCALE,
      maxPixels: 1e10,
      tileScale: 8
    });

    return ee.Feature(null, stats.set('year', year));
  }

  var years = [];
  for (var y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    years.push(yearStats(y));
  }
  var trajectory = ee.FeatureCollection(years);

  var cols = ['year', 'intact_mean', 'intact_count'];
  for (var j = 0; j < COHORTS.length; j++) {
    cols.push('c' + COHORTS[j] + '_mean', 'c' + COHORTS[j] + '_count');
  }

  Export.table.toDrive({
    collection: trajectory,
    description: 'cht_recovery_trajectory',
    folder: DRIVE_FOLDER,
    fileFormat: 'CSV',
    selectors: cols
  });

  var meanCols = ['intact_mean'];
  for (var k = 0; k < COHORTS.length; k++) {
    meanCols.push('c' + COHORTS[k] + '_mean');
  }

  print(ui.Chart.feature.byFeature(trajectory, 'year', meanCols)
    .setChartType('LineChart')
    .setOptions({
      title: 'Dry-season NDVI: intact forest vs each loss cohort',
      hAxis: {title: 'Year', format: '####'},
      vAxis: {title: 'Mean NDVI'},
      pointSize: 4
    }));
}

// ============================================================================
// PART B — PER-PIXEL RECOVERY
// ============================================================================

if (RUN_PART_B) {

  var pre  = ndviYear(MAP_COHORT - 1);
  var post = ndviYear(MAP_COHORT + 5);
  var cohortMask = lossYear.eq(MAP_COHORT - 2000).and(forest2000);

  var recovered = post.divide(pre).gte(RECOVERY_RATIO)
    .updateMask(cohortMask).rename('recovered');

  var areaHa = ee.Image.pixelArea().divide(10000);

  var split = ee.Image.cat([
    recovered.eq(1).multiply(areaHa).rename('recovered_ha'),
    recovered.eq(0).multiply(areaHa).rename('not_recovered_ha')
  ]).reduceRegions({
    collection: districts,
    reducer: ee.Reducer.sum(),
    scale: MAP_SCALE,
    tileScale: 8
  });

  print('Cohort ' + MAP_COHORT + ' at ratio ' + RECOVERY_RATIO + ':');

  Export.table.toDrive({
    collection: split,
    description: 'cht_recovery_' + MAP_COHORT + '_r' +
                 String(RECOVERY_RATIO).replace('.', ''),
    folder: DRIVE_FOLDER,
    fileFormat: 'CSV',
    selectors: ['ADM2_NAME', 'recovered_ha', 'not_recovered_ha']
  });

  Map.addLayer(cht, {color: '000000'}, 'CHT boundary', true, 0.5);
  Map.addLayer(recovered.eq(1).selfMask(), {palette: ['2E7D32']},
               'Regrown by ' + (MAP_COHORT + 5));
  Map.addLayer(recovered.eq(0).selfMask(), {palette: ['C62828']},
               'Still cleared ' + (MAP_COHORT + 5));

  Export.image.toDrive({
    image: recovered.unmask(255).toByte(),
    description: 'cht_recovery_map_' + MAP_COHORT,
    folder: DRIVE_FOLDER,
    region: cht,
    scale: MAP_SCALE,
    crs: 'EPSG:32646',
    maxPixels: 1e10
  });
}