import { describe, expect, it } from 'vitest'
import { validateSxfP21 } from '../../../scripts/tools/validate-sxf.mjs'

const VALID_P21 = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('sample.P21','2026-08-10T00:00:00Z',(''),(''),'CivilDraft','', '');
FILE_SCHEMA(('AP202'));
ENDSEC;
DATA;
#1=LINE('L1',(0.,0.,0.),(1000.,0.,0.));
#2=TRIMMED_CURVE('A1',#3,(PARAMETER_VALUE(0.),PARAMETER_VALUE(1.)),.T.,.P.);
ENDSEC;
END-ISO-10303-21;
`

const INVALID_P21 = `not-a-step-file;
ENTITY_LINE_WITHOUT_HASH;
`

describe('validateSxfP21', () => {
  it('ISO 10303-21 の基本構造・TRIMMED_CURVE を検証して OK を返す', () => {
    const result = validateSxfP21(VALID_P21)
    expect(result.ok).toBe(true)
    expect(result.entityCount).toBe(2)
    expect(result.trimmedCurveCount).toBe(1)
  })

  it('ヘッダー欠落・構文不正をエラーとして報告する', () => {
    const result = validateSxfP21(INVALID_P21)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.some((error) => error.includes('ISO-10303-21'))).toBe(true)
    expect(result.errors.some((error) => error.includes('FILE_DESCRIPTION'))).toBe(true)
  })
})
