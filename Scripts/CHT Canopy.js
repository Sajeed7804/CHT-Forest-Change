
var GFC_ASSET = 'UMD/hansen/global_forest_change_2023_v1_11';
var TREE_COVER_THRESHOLD = 30;
var DISTRICTS = ['Rangamati', 'Khagrachhari', 'Bandarban'];
var DRIVE_FOLDER = 'cht_forest_change';

var GEDI_START = '2024-01-01';
var GEDI_END   = '2025-07-01';

var SCALE = 25;

// ============================================================================
// STUDY AREA AND MASKS
// ============================================================================

var cht = ee.FeatureCollection('FAO/GAUL/2015/level2')
  .filter(ee.Filter.eq('ADM0_NAME', 'Bangladesh'))
  .filter(ee.Filter.inList('ADM2_NAME', DISTRICTS))
  .union().first().geometry();

var gfc        = ee.Image(GFC_ASSET);
var lossYear   = gfc.select('lossyear');
var forest2000 = gfc.select('treecover2000').gte(TREE_COVER_THRESHOLD)
                    .and(gfc.select('datamask').eq(1));

var intact = forest2000.and(lossYear.eq(0));

Map.centerObject(cht, 8);

// ============================================================================
// GEDI
// ============================================================================

var gediRaw = ee.ImageCollection('LARSE/GEDI/GEDI02_A_002_MONTHLY')
  .filterBounds(cht)
  .filterDate(GEDI_START, GEDI_END);

print('GEDI images in window:', gediRaw.size());

function qualityMask(im) {
  return im.updateMask(im.select('quality_flag').eq(1))
           .updateMask(im.select('degrade_flag').eq(0));
}

var height = gediRaw.map(qualityMask).select('rh98').mosaic().rename('h');

// ============================================================================
// ONE GROUPED REDUCTION
// ============================================================================

var code = ee.Image(0)
  .where(lossYear.eq(14).and(forest2000), 14)
  .where(lossYear.eq(16).and(forest2000), 16)
  .where(lossYear.eq(18).and(forest2000), 18)
  .where(lossYear.eq(20).and(forest2000), 20)
  .where(lossYear.eq(22).and(forest2000), 22)
  .where(intact, 99)
  .rename('code');

var stats = height.addBands(code)
  .updateMask(code.gt(0))
  .reduceRegion({
    reducer: ee.Reducer.mean()
      .combine({reducer2: ee.Reducer.median(), sharedInputs: true})
      .combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true})
      .combine({reducer2: ee.Reducer.count(), sharedInputs: true})
      .group({groupField: 1, groupName: 'code'}),
    geometry: cht,
    scale: SCALE,
    maxPixels: 1e10,
    bestEffort: true,
    tileScale: 16
  });

print('GEDI rh98 by group — 99 = never cleared:', stats);

// ============================================================================
// EXPORT
// ============================================================================

var rows = ee.List(stats.get('groups')).map(function (d) {
  d = ee.Dictionary(d);
  return ee.Feature(null, {
    code: d.get('code'),
    mean_h: d.get('mean'),
    median_h: d.get('median'),
    sd_h: d.get('stdDev'),
    footprints: d.get('count')
  });
});

Export.table.toDrive({
  collection: ee.FeatureCollection(rows),
  description: 'cht_gedi_height_2024on',
  folder: DRIVE_FOLDER,
  fileFormat: 'CSV',
  selectors: ['code', 'mean_h', 'median_h', 'sd_h', 'footprints']
});

// ============================================================================
// MAP
// ============================================================================

var hVis = {min: 0, max: 30, palette: ['ffffcc', 'c2e699', '78c679', '005a32']};
Map.addLayer(cht, {color: '000000'}, 'CHT boundary', true, 0.5);
Map.addLayer(height.updateMask(intact), hVis, 'GEDI — never cleared');
Map.addLayer(height.updateMask(lossYear.eq(14).and(forest2000)), hVis,
             'GEDI — cleared 2014');
Map.addLayer(height.updateMask(lossYear.eq(22).and(forest2000)), hVis,
             'GEDI — cleared 2022');