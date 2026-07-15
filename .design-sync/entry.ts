// Synthetic re-export barrel for the design-sync converter.
// This repo is an application, not a published package — there is no dist/
// and nothing installs itself into node_modules/civildraft-web-cad, so the
// converter can't auto-discover an entry. This file stands in for that
// entry (cfg.entry) so esbuild has a real, traceable set of exports for the
// 14 components chosen for the design-system sync (Sidebar + 13 business
// screens under src/app/pages/, including the CAD Editor canvas screen).
// See .design-sync/NOTES.md for the full rationale.
//
// EditorStoreProvider/createEditorStore are re-exported (named, not `export *`,
// to avoid pulling editorStore.ts's many non-component identifiers into the
// bundle's export surface) so that preview files can wrap store-dependent
// pages in a provider while importing everything through the same bare
// 'civildraft-web-cad' specifier — required for React Context identity
// across the dsShim (see NOTES.md). createAutosaveStore is re-exported for
// the same reason: CadEditorPage/DrawingComparePage/HomePage take an
// AutosaveStore instance as a prop, and previews need to construct one
// in-memory (MemoryAutosaveStore, via createAutosaveStore's IDBFactory-less
// fallback) rather than depend on a real IndexedDB.
// Explicit .tsx extension: this repo's editorStoreContext.ts/EditorStoreContext.tsx
// react-refresh split makes extensionless resolution ambiguous even with the
// bundle.mjs override's .ts-before-.tsx fix (that fix resolves the collision
// for lowercase '../editorStoreContext' imports, but flips it for this
// capitalized one — esbuild probes 'EditorStoreContext.ts', case-insensitively
// matches the real lowercase file, then fails reading the literal-case path).
// An explicit extension skips resolveExtensions probing entirely.
export { EditorStoreProvider } from '../src/app/store/EditorStoreContext.tsx';
export { createEditorStore } from '../src/app/store/editorStore';
export { createAutosaveStore } from '../src/infrastructure/autosave/autosaveStore';
export * from '../src/app/layout/Sidebar';
export * from '../src/app/pages/CadEditorPage';
export * from '../src/app/pages/ConstructionStepsPage';
export * from '../src/app/pages/CrossSectionPage';
export * from '../src/app/pages/DrawingComparePage';
export * from '../src/app/pages/DrawingSettingsPage';
export * from '../src/app/pages/HomePage';
export * from '../src/app/pages/PartsPalettePage';
export * from '../src/app/pages/PrintExportPage';
export * from '../src/app/pages/ProjectDetailPage';
export * from '../src/app/pages/QuantitySummaryPage';
export * from '../src/app/pages/ReviewApprovalPage';
export * from '../src/app/pages/SurveyPointsPage';
export * from '../src/app/pages/SystemSettingsPage';
