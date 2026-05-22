import { describe, it, expect } from 'vitest'
import {
  buildContactMarkdown,
  parseBulletsToFields,
  parseContactContent,
  serializeFieldsToBullets,
  type ParsedLocalFields
} from '../contactFields'

const empty = (): ParsedLocalFields => ({
  emails: [], phones: [], addresses: [], urls: [], orgs: [], biographyLines: []
})

describe('parseBulletsToFields', () => {
  it('groups recognised labels by kind, with type extracted from trailing parens', () => {
    const fields = parseBulletsToFields([
      'email: jane@x.com (work)',
      'email: j@personal.com',
      'phone: +1 555-0100 (mobile)',
      'address: 123 Main St, Brooklyn NY (home)',
      'url: https://example.com (homepage)',
      'org: Acme',
      'title: CEO',
      'Met at the 2025 offsite',
      'Likes hiking'
    ])
    expect(fields.emails).toEqual([
      { value: 'jane@x.com', type: 'work' },
      { value: 'j@personal.com', type: null }
    ])
    expect(fields.phones).toEqual([{ value: '+1 555-0100', type: 'mobile' }])
    expect(fields.addresses).toEqual([{ value: '123 Main St, Brooklyn NY', type: 'home' }])
    expect(fields.urls).toEqual([{ value: 'https://example.com', type: 'homepage' }])
    expect(fields.orgs).toEqual([{ name: 'Acme', title: 'CEO' }])
    expect(fields.biographyLines).toEqual(['Met at the 2025 offsite', 'Likes hiking'])
  })

  it('pairs orgs and titles positionally; extras get a synthetic empty-name org', () => {
    const fields = parseBulletsToFields([
      'org: Acme',
      'org: Beta',
      'title: CEO',
      'title: Adviser',
      'title: Consultant'
    ])
    expect(fields.orgs).toEqual([
      { name: 'Acme', title: 'CEO' },
      { name: 'Beta', title: 'Adviser' },
      { name: '', title: 'Consultant' }
    ])
  })

  it('treats unknown bullet prefixes as biography lines, not structured fields', () => {
    const fields = parseBulletsToFields([
      'birthday: 1990-01-01',
      'favourite-colour: blue'
    ])
    expect(fields.emails).toEqual([])
    expect(fields.biographyLines).toEqual(['birthday: 1990-01-01', 'favourite-colour: blue'])
  })
})

describe('serializeFieldsToBullets', () => {
  it('emits labels in canonical order: email → phone → address → url → org/title → notes', () => {
    const bullets = serializeFieldsToBullets({
      ...empty(),
      biographyLines: ['Note A'],
      orgs: [{ name: 'Acme', title: 'CEO' }],
      urls: [{ value: 'https://x', type: null }],
      addresses: [{ value: '1 Main', type: 'home' }],
      phones: [{ value: '+1 555', type: 'mobile' }],
      emails: [{ value: 'a@b', type: 'work' }]
    })
    expect(bullets).toEqual([
      'email: a@b (work)',
      'phone: +1 555 (mobile)',
      'address: 1 Main (home)',
      'url: https://x',
      'org: Acme',
      'title: CEO',
      'Note A'
    ])
  })

  it('drops empty values and empty orgs/titles', () => {
    const bullets = serializeFieldsToBullets({
      ...empty(),
      emails: [{ value: '', type: 'work' }, { value: 'a@b', type: null }],
      orgs: [{ name: '', title: '' }, { name: 'OnlyName', title: '' }]
    })
    expect(bullets).toEqual(['email: a@b', 'org: OnlyName'])
  })
})

describe('parse → serialize round-trip', () => {
  it('is idempotent for any structured input the parser accepts', () => {
    const original = [
      'email: jane@x.com (work)',
      'phone: +1 555-0100 (mobile)',
      'address: 123 Main St (home)',
      'url: https://example.com',
      'org: Acme',
      'title: CEO',
      'Met at the 2025 offsite',
      'Likes hiking'
    ]
    const once = serializeFieldsToBullets(parseBulletsToFields(original))
    const twice = serializeFieldsToBullets(parseBulletsToFields(once))
    expect(once).toEqual(twice)
    // And every original line survives somewhere in the output (either as a
    // canonical bullet or as a biography line) — load-bearing safety for the
    // structured editor over an unstructured file format.
    for (const line of original) expect(once).toContain(line)
  })

  it('preserves unrecognized bullets as biography lines after a round-trip', () => {
    const original = ['birthday: 1990-01-01', 'email: x@y.com']
    const fields = parseBulletsToFields(original)
    const bullets = serializeFieldsToBullets(fields)
    expect(bullets).toContain('birthday: 1990-01-01')
    expect(bullets).toContain('email: x@y.com')
  })
})

describe('parseContactContent', () => {
  it('extracts entity name, kind, and field bullets from a full markdown file', () => {
    const content = [
      '# Entity: Jane Doe',
      '- kind: person',
      '- email: jane@x.com (work)',
      '- phone: +1 555-0100',
      '- Met at the offsite',
      ''
    ].join('\n')

    const parsed = parseContactContent(content)
    expect(parsed.entityName).toBe('Jane Doe')
    expect(parsed.kind).toBe('person')
    expect(parsed.fields.emails).toEqual([{ value: 'jane@x.com', type: 'work' }])
    expect(parsed.fields.phones).toEqual([{ value: '+1 555-0100', type: null }])
    expect(parsed.fields.biographyLines).toEqual(['Met at the offsite'])
  })

  it('defaults kind to other when the bullet is absent', () => {
    const parsed = parseContactContent('# Entity: Unknown\n- email: a@b\n')
    expect(parsed.kind).toBe('other')
  })

  it('returns null entity name when the header is missing', () => {
    const parsed = parseContactContent('- email: a@b\n')
    expect(parsed.entityName).toBe(null)
  })
})

describe('buildContactMarkdown', () => {
  it('emits the canonical header → kind → bullets → trailing newline shape', () => {
    const out = buildContactMarkdown('Jane Doe', 'person', {
      ...empty(),
      emails: [{ value: 'jane@x.com', type: 'work' }],
      biographyLines: ['Met at the offsite']
    })
    expect(out).toBe(
      '# Entity: Jane Doe\n' +
      '- kind: person\n' +
      '- email: jane@x.com (work)\n' +
      '- Met at the offsite\n'
    )
  })

  it('parse(build(parse(content))) === parse(content) for round-trip stability', () => {
    const original = [
      '# Entity: Jane Doe',
      '- kind: business',
      '- email: jane@x.com (work)',
      '- phone: +1 555-0100',
      '- birthday: 1990-01-01',
      '- Met at the offsite',
      ''
    ].join('\n')
    const a = parseContactContent(original)
    const rebuilt = buildContactMarkdown(a.entityName!, a.kind, a.fields)
    const b = parseContactContent(rebuilt)
    expect(b).toEqual(a)
  })
})
