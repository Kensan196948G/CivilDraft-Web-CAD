import type { Geometry, GeometryId, GeometryStyle, LayerId } from '@/shared/types'

const DEMO_LAYER_ID = 'layer-default' as LayerId
const DEMO_STYLE: GeometryStyle = {
  strokeColor: '#1f2937',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

function base(id: string) {
  return {
    id: id as GeometryId,
    layerId: DEMO_LAYER_ID,
    style: DEMO_STYLE,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  } as const
}

export function createDemoDrawingGeometries(): readonly Geometry[] {
  return [
    {
      ...base('demo-yard-centerline'),
      type: 'line',
      start: { x: 20000, y: 20000 },
      end: { x: 220000, y: 20000 },
    },
    {
      ...base('demo-material-yard'),
      type: 'rectangle',
      origin: { x: 42000, y: 54000 },
      width: 52000,
      height: 28000,
      rotationDeg: 0,
    },
    {
      ...base('demo-crane-radius'),
      type: 'circle',
      center: { x: 150000, y: 76000 },
      radius: 30000,
    },
    {
      ...base('demo-earthwork-area'),
      type: 'polyline',
      points: [
        { x: 26000, y: 118000 },
        { x: 88000, y: 108000 },
        { x: 126000, y: 138000 },
        { x: 74000, y: 168000 },
      ],
      closed: true,
    },
    {
      ...base('demo-cone'),
      type: 'symbol',
      symbolId: 'cone',
      position: { x: 186000, y: 126000 },
      rotationDeg: 0,
      scale: 1,
    },
  ]
}
