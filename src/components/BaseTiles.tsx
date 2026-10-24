import { TileLayer } from 'react-leaflet'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas'

/** Esri Dark Gray Canvas: free, no API key, reads well under colored overlays. */
export default function BaseTiles({ labels = true }: { labels?: boolean }) {
  return (
    <>
      <TileLayer
        url={`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`}
        attribution="Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
        maxNativeZoom={16}
        maxZoom={19}
      />
      {labels && <TileLayer url={`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={16} maxZoom={19} />}
    </>
  )
}
