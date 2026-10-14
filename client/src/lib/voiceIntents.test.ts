import { describe, it, expect } from 'vitest'
import { parseIntent, resolveSpokenFile, normalize } from './voiceIntents'

const files = [
  { path: 'server/src/index.js', sha: 'a' },
  { path: 'client/src/index.css', sha: 'b' },
  { path: 'server/src/controllers/authController.ts', sha: 'c' },
  { path: 'server/src/routes/orders.js', sha: 'd' },
  { path: 'client/src/components/ImportantFilesTab.tsx', sha: 'e' },
]

describe('parseIntent', () => {
  it('handles control words instantly', () => {
    expect(parseIntent('Stop')).toEqual({ kind: 'stop' })
    expect(parseIntent('skip')).toEqual({ kind: 'skip' })
    expect(parseIntent('next page')).toEqual({ kind: 'skip' })
    expect(parseIntent('say that again')).toEqual({ kind: 'repeat' })
    expect(parseIntent('speak faster please')).toEqual({ kind: 'faster' })
    expect(parseIntent('slow down')).toEqual({ kind: 'slower' })
    expect(parseIntent('what can you do?')).toEqual({ kind: 'help' })
    expect(parseIntent('reply in Hindi')).toEqual({ kind: 'language', lang: 'hi' })
  })

  it('navigates only with a navigation verb or a bare page name', () => {
    expect(parseIntent('Hey Pilot, open the security audit')).toEqual({ kind: 'navigate', tab: 'Security Audit' })
    expect(parseIntent('take me to the API routes')).toEqual({ kind: 'navigate', tab: 'APIs & Routes' })
    expect(parseIntent('go to time machine')).toEqual({ kind: 'navigate', tab: 'Time Machine' })
    expect(parseIntent('environment variables')).toEqual({ kind: 'navigate', tab: 'Env Variables' })
    expect(parseIntent('show me the onboarding score')).toEqual({ kind: 'navigate', tab: 'Onboarding Score' })
    // questions are left for Gemma 4
    expect(parseIntent("what's the security score of this repo")).toBeNull()
    expect(parseIntent('how do I run this project?')).toBeNull()
  })

  it('recognises explain and tour requests', () => {
    expect(parseIntent('explain this page')).toEqual({ kind: 'explain', tab: undefined })
    expect(parseIntent('What am I looking at?')).toEqual({ kind: 'explain', tab: undefined })
    expect(parseIntent('explain the architecture page')).toEqual({ kind: 'explain', tab: 'Architecture' })
    expect(parseIntent('explain security')).toEqual({ kind: 'explain', tab: 'Security Audit' })
    expect(parseIntent('give me a tour')).toEqual({ kind: 'tour' })
    expect(parseIntent('walk me through this repo')).toEqual({ kind: 'tour' })
  })

  it('opens file stories and detailed analysis by spoken file names', () => {
    expect(parseIntent('tell me the story of auth controller', files)).toEqual({ kind: 'fileStory', path: 'server/src/controllers/authController.ts', sha: 'c' })
    expect(parseIntent('history of orders dot js', files)).toEqual({ kind: 'fileStory', path: 'server/src/routes/orders.js', sha: 'd' })
    expect(parseIntent('analyze important files tab', files)).toEqual({ kind: 'detailed', path: 'client/src/components/ImportantFilesTab.tsx', sha: 'e' })
    // ambiguous name -> let Gemma decide
    expect(parseIntent('story of index', files)).toBeNull()
  })
})

describe('helpers', () => {
  it('resolves spoken file names', () => {
    expect(resolveSpokenFile('index dot js', files)?.path).toBe('server/src/index.js')
    expect(resolveSpokenFile('index', files)).toBeNull()
    expect(resolveSpokenFile('nonexistent thing', files)).toBeNull()
  })
  it('normalises filler words', () => {
    expect(normalize('Hey Pilot, could you please open security?')).toBe('open security')
  })
})
