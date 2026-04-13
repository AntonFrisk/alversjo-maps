import sharp from 'sharp';
await sharp('public/elevation/elevation_map_alversjo.tif')
  .toFile('public/elevation/elevation_map_alversjo.png');
console.log('Done: public/elevation/elevation_map_alversjo.png');
