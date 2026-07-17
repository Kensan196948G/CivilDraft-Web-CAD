import { EditorStoreProvider, PartsPalettePage, createEditorStore } from 'civildraft-web-cad'

function createDefaultLayer() {
  return {
    id: 'layer-default',
    name: 'レイヤー0',
    order: 0,
    visible: true,
    locked: false,
    printable: true,
    defaultStyle: {
      strokeColor: '#1F2933',
      strokeWidth: 1,
      lineType: 'continuous',
      opacity: 1,
      printable: true,
    },
  }
}

function seededStore() {
  const layer = createDefaultLayer()
  const store = createEditorStore()
  store.getState().replaceDocument(
    [
      {
        id: 'g-1',
        layerId: layer.id,
        type: 'line',
        style: layer.defaultStyle,
        constructionStepIds: [],
        locked: false,
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
        start: { x: 0, y: 0 },
        end: { x: 5000, y: 0 },
      },
      {
        id: 'g-2',
        layerId: layer.id,
        type: 'symbol',
        style: layer.defaultStyle,
        constructionStepIds: [],
        locked: false,
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
        symbolId: 'bm',
        position: { x: 0, y: 0 },
        rotationDeg: 0,
        scale: 1,
      },
    ] as any,
    [layer as any],
  )
  return store
}

export function Default() {
  return (
    <EditorStoreProvider store={createEditorStore()}>
      <PartsPalettePage />
    </EditorStoreProvider>
  )
}

export function WithPlacedGeometry() {
  return (
    <EditorStoreProvider store={seededStore()}>
      <PartsPalettePage onOpenEditor={() => {}} />
    </EditorStoreProvider>
  )
}
