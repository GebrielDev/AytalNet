import { TileLayer } from 'react-leaflet';

/** Base map tiles. In dark mode they are darkened by CSS (.dark .leaflet-tile-pane in index.css). */
export default function MapTiles() {
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    />
  );
}
