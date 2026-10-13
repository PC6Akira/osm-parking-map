/**
 * 把查询结果（含 geometry 字段）转换为 GeoJSON FeatureCollection
 */
function featureCollection(rows) {
  return {
    type: 'FeatureCollection',
    features: rows.map((row) => {
      const { geometry, ...properties } = row;
      return { type: 'Feature', geometry, properties };
    }),
  };
}

/** 单个对象转 Feature */
function feature(row) {
  const { geometry, ...properties } = row;
  return { type: 'Feature', geometry, properties };
}

module.exports = { featureCollection, feature };
