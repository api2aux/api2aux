/**
 * Functional tests: multi-endpoint and multi-round conversations.
 *
 * Tests scenarios where the engine must call 2+ endpoints to answer a question.
 * Split into simple (1 endpoint), complex (2+ endpoints), and conversation continuity.
 */

import { describe, it, expect } from 'vitest'
import { loadSpec, buildTestEngine, collectEvents } from '../helpers/setup'
import { createScriptedLlm } from '../helpers/mock-llm'
import { createMockExecutor } from '../helpers/mock-executor'
import { ChatEventType } from '../../src/types'

// ── Mock data for D&D 5e API ──

const DND_CLASSES_LIST = {
  count: 12,
  results: [
    { index: 'barbarian', name: 'Barbarian', url: '/api/classes/barbarian' },
    { index: 'bard', name: 'Bard', url: '/api/classes/bard' },
    { index: 'cleric', name: 'Cleric', url: '/api/classes/cleric' },
    { index: 'fighter', name: 'Fighter', url: '/api/classes/fighter' },
    { index: 'wizard', name: 'Wizard', url: '/api/classes/wizard' },
  ],
}

const DND_FIGHTER_DETAIL = {
  index: 'fighter',
  name: 'Fighter',
  hit_die: 10,
  proficiency_choices: [{ desc: 'Choose two skills' }],
  subclasses: [
    { index: 'champion', name: 'Champion', url: '/api/subclasses/champion' },
    { index: 'battle-master', name: 'Battle Master', url: '/api/subclasses/battle-master' },
  ],
}

const DND_BARBARIAN_DETAIL = {
  index: 'barbarian',
  name: 'Barbarian',
  hit_die: 12,
  proficiency_choices: [{ desc: 'Choose two skills' }],
  subclasses: [
    { index: 'berserker', name: 'Berserker', url: '/api/subclasses/berserker' },
  ],
}

const DND_WIZARD_DETAIL = {
  index: 'wizard',
  name: 'Wizard',
  hit_die: 6,
  spellcasting: { level: 1, spellcasting_ability: { index: 'int', name: 'INT' } },
  subclasses: [
    { index: 'evocation', name: 'School of Evocation', url: '/api/subclasses/evocation' },
  ],
}

const DND_CLERIC_DETAIL = {
  index: 'cleric',
  name: 'Cleric',
  hit_die: 8,
  subclasses: [
    { index: 'life', name: 'Life Domain', url: '/api/subclasses/life' },
    { index: 'light', name: 'Light Domain', url: '/api/subclasses/light' },
  ],
}

const DND_LIFE_SUBCLASS = {
  index: 'life',
  name: 'Life Domain',
  desc: ['The Life domain focuses on the vibrant positive energy...'],
  class: { index: 'cleric', name: 'Cleric' },
  spells: [{ spell: { index: 'bless', name: 'Bless' } }],
}

const DND_MONSTERS_LIST = {
  count: 3,
  results: [
    { index: 'aboleth', name: 'Aboleth', url: '/api/monsters/aboleth' },
    { index: 'adult-black-dragon', name: 'Adult Black Dragon', url: '/api/monsters/adult-black-dragon' },
    { index: 'ancient-red-dragon', name: 'Ancient Red Dragon', url: '/api/monsters/ancient-red-dragon' },
  ],
}

const DND_ABOLETH_DETAIL = {
  index: 'aboleth',
  name: 'Aboleth',
  size: 'Large',
  type: 'aberration',
  hit_points: 135,
  challenge_rating: 10,
}

const DND_WIZARD_LEVEL3_SPELLS = {
  count: 5,
  results: [
    { index: 'fireball', name: 'Fireball', level: 3, url: '/api/spells/fireball' },
    { index: 'counterspell', name: 'Counterspell', level: 3, url: '/api/spells/counterspell' },
    { index: 'fly', name: 'Fly', level: 3, url: '/api/spells/fly' },
  ],
}

const DND_FIREBALL_DETAIL = {
  index: 'fireball',
  name: 'Fireball',
  level: 3,
  school: { index: 'evocation', name: 'Evocation' },
  classes: [{ index: 'sorcerer', name: 'Sorcerer' }, { index: 'wizard', name: 'Wizard' }],
  damage: { damage_type: { index: 'fire', name: 'Fire' } },
  desc: ['A bright streak flashes from your pointing finger...'],
}

const DND_API_ROOT = {
  'ability-scores': '/api/ability-scores',
  'classes': '/api/classes',
  'monsters': '/api/monsters',
  'spells': '/api/spells',
  'races': '/api/races',
}

// ── Dynamic mock executor for D&D ──

function createDndExecutor() {
  return createMockExecutor((toolName, args) => {
    // Root endpoint
    if (toolName === 'get_api') return DND_API_ROOT

    // List endpoint
    if (toolName === 'get_api_endpoint') {
      const endpoint = args.endpoint as string
      if (endpoint === 'classes') return DND_CLASSES_LIST
      if (endpoint === 'monsters') return DND_MONSTERS_LIST
      return { count: 0, results: [] }
    }

    // Class detail
    if (toolName.includes('classes') && toolName.includes('index') && !toolName.includes('level')) {
      const index = args.index as string
      if (index === 'fighter') return DND_FIGHTER_DETAIL
      if (index === 'barbarian') return DND_BARBARIAN_DETAIL
      if (index === 'wizard') return DND_WIZARD_DETAIL
      if (index === 'cleric') return DND_CLERIC_DETAIL
      throw new Error(`Unknown class: ${index}`)
    }

    // Wizard level 3 spells
    if (toolName.includes('level') && toolName.includes('spell')) {
      return DND_WIZARD_LEVEL3_SPELLS
    }

    // Subclass detail (tool name: get_api_subclasses_by_id or similar)
    if (toolName.includes('subclass') && !toolName.includes('level') && !toolName.includes('feature')) {
      if (args.index === 'life') return DND_LIFE_SUBCLASS
      return { index: args.index, name: String(args.index) }
    }

    // Monster detail
    if (toolName.includes('monster') && toolName.includes('index')) {
      if (args.index === 'aboleth') return DND_ABOLETH_DETAIL
      return { index: args.index, name: String(args.index) }
    }

    // Monster list (direct)
    if (toolName.includes('monster') && !toolName.includes('index')) {
      return DND_MONSTERS_LIST
    }

    // Spell detail
    if (toolName.includes('spell') && toolName.includes('index')) {
      if (args.index === 'fireball') return DND_FIREBALL_DETAIL
      return { index: args.index, name: String(args.index) }
    }

    // Spell list (direct)
    if (toolName.includes('spell') && !toolName.includes('index')) {
      return { count: 5, results: [{ index: 'fireball', name: 'Fireball' }] }
    }

    return { result: 'ok', tool: toolName }
  })
}

// ── Simple scenarios (1 endpoint) ──

describe('Simple scenarios (1 endpoint)', () => {
  it('D&D: list all resource types', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      { toolCalls: [{ name: 'get_api', args: {} }] },
      { text: 'The API provides classes, monsters, spells, races, and more.' },
    ])
    const engine = buildTestEngine(spec, llm, createDndExecutor())
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('List all available resource types', handler)

    expect(result.toolResults).toHaveLength(1)
    expect(result.toolResults[0]!.toolName).toBe('get_api')
    expect(result.text).toContain('classes')
  })

  it('D&D: direct detail lookup for wizard class', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'wizard' } }] },
      { text: 'The Wizard class has a hit die of 6 and focuses on spellcasting.' },
    ])
    const engine = buildTestEngine(spec, llm, createDndExecutor())
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('Show me the wizard class', handler)

    expect(result.toolResults).toHaveLength(1)
    expect(result.toolResults[0]!.data).toEqual(DND_WIZARD_DETAIL)
  })
})

// ── Complex scenarios (2+ endpoints) ──

describe('Complex scenarios (2+ endpoints)', () => {
  it('D&D: chained lookup — wizard spells at level 3', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      // Round 1: get class detail
      { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'wizard' } }] },
      // Round 2: get level 3 spells using class info
      { toolCalls: [{ name: 'get_api_classes_index_levels_spell_level_spells', args: { index: 'wizard', spell_level: '3' } }] },
      // Round 3: text response
      { text: 'At level 3, wizards can cast Fireball, Counterspell, and Fly.' },
    ])
    const engine = buildTestEngine(spec, llm, createDndExecutor())
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('What spells can a wizard cast at level 3?', handler)

    expect(result.toolResults).toHaveLength(2)
    expect(result.toolResults[0]!.toolName).toMatch(/class/i)
    expect(result.toolResults[1]!.toolName).toMatch(/spell/i)
    expect(result.text).toContain('Fireball')
  })

  it('D&D: parallel detail lookups — compare fighter and barbarian', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      // Round 1: LLM calls two detail endpoints in parallel
      { toolCalls: [
        { name: 'get_api_classes_index', args: { index: 'fighter' } },
        { name: 'get_api_classes_index', args: { index: 'barbarian' } },
      ] },
      // Round 2: text response comparing them
      { text: 'The Fighter has d10 hit die while the Barbarian has d12.' },
    ])
    const engine = buildTestEngine(spec, llm, createDndExecutor())
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('Compare the fighter and barbarian classes', handler)

    expect(result.toolResults).toHaveLength(2)

    const toolNames = result.toolResults.map(r => r.toolName)
    expect(toolNames.every(n => n.includes('class'))).toBe(true)

    // Both class data should be present
    const hitDies = result.toolResults.map(r => (r.data as Record<string, unknown>).hit_die)
    expect(hitDies).toContain(10) // Fighter
    expect(hitDies).toContain(12) // Barbarian
  })

  it('D&D: follow-the-reference — cleric subclasses', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      // Round 1: get cleric class with subclass references
      { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'cleric' } }] },
      // Round 2: follow reference to get Life subclass detail
      // Tool name is auto-generated: GET /api/subclasses/{index} → get_api_subclasses_by_id
      { toolCalls: [{ name: 'get_api_subclasses_by_id', args: { index: 'life' } }] },
      // Round 3: text response
      { text: 'The Cleric has Life Domain and Light Domain subclasses. The Life Domain focuses on positive energy and healing.' },
    ])
    const engine = buildTestEngine(spec, llm, createDndExecutor())
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('What are the subclasses of the cleric?', handler)

    expect(result.toolResults).toHaveLength(2)
    expect(result.toolResults[0]!.toolName).toMatch(/class/i)
    expect(result.toolResults[1]!.toolName).toMatch(/subclass/i)

    const subclassData = result.toolResults[1]!.data as Record<string, unknown>
    expect(subclassData.name).toBe('Life Domain')
  })

  it('D&D: list-then-detail — monsters browse pattern', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      // Round 1: list monsters
      { toolCalls: [{ name: 'get_api_monsters', args: {} }] },
      // Round 2: get first monster detail (aboleth)
      { toolCalls: [{ name: 'get_api_monsters_index', args: { index: 'aboleth' } }] },
      // Round 3: text response
      { text: 'Found 3 monsters. The Aboleth is a Large aberration with 135 HP and CR 10.' },
    ])
    const engine = buildTestEngine(spec, llm, createDndExecutor())
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('List all monsters and tell me about the first one', handler)

    expect(result.toolResults).toHaveLength(2)

    // First result is the list
    const listData = result.toolResults[0]!.data as Record<string, unknown>
    expect(listData.count).toBe(3)

    // Second result is the detail
    const detailData = result.toolResults[1]!.data as Record<string, unknown>
    expect(detailData.name).toBe('Aboleth')
    expect(detailData.hit_points).toBe(135)
  })

  it('D&D: cross-entity — spell detail then related classes', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      // Round 1: get fireball spell detail
      { toolCalls: [{ name: 'get_api_spells_index', args: { index: 'fireball' } }] },
      // Round 2: get wizard class (one of the classes that can cast fireball)
      { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'wizard' } }] },
      // Round 3: text response
      { text: 'Fireball is a level 3 Evocation spell. Wizards and Sorcerers can learn it.' },
    ])
    const engine = buildTestEngine(spec, llm, createDndExecutor())
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('Tell me about the fireball spell and who can cast it', handler)

    expect(result.toolResults).toHaveLength(2)
    expect(result.toolResults[0]!.toolName).toMatch(/spell/i)
    expect(result.toolResults[1]!.toolName).toMatch(/class/i)

    const spellData = result.toolResults[0]!.data as Record<string, unknown>
    expect(spellData.name).toBe('Fireball')
  })
})

// ── Conversation continuity (2+ messages) ──

describe('Conversation continuity', () => {
  it('follow-up question uses context from first message', async () => {
    const spec = await loadSpec('dnd5e')

    // First message: look up wizard class
    const llm1 = createScriptedLlm([
      { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'wizard' } }] },
      { text: 'The Wizard class has d6 hit die and focuses on spellcasting.' },
    ])
    const executor = createDndExecutor()
    const engine = buildTestEngine(spec, llm1, executor)
    const { handler: handler1 } = collectEvents()

    const result1 = await engine.sendMessage('Show me the wizard class', handler1)
    expect(result1.toolResults).toHaveLength(1)

    // Second message: follow-up about spells (engine should have wizard context in history)
    // Replace the LLM for the second message
    let secondCallCount = 0
    const secondLlm = async (messages: unknown[], tools: unknown[], onToken: (t: string) => void) => {
      secondCallCount++
      if (secondCallCount === 1) {
        // Engine should send wizard context in history — LLM uses it
        return {
          content: '',
          tool_calls: [{
            id: 'call_followup_1',
            type: 'function' as const,
            function: {
              name: 'get_api_classes_index_levels_spell_level_spells',
              arguments: JSON.stringify({ index: 'wizard', spell_level: '3' }),
            },
          }],
          finish_reason: 'tool_calls',
        }
      }
      const text = 'At level 3, wizards can cast Fireball, Counterspell, and Fly.'
      onToken(text)
      return { content: text, tool_calls: [], finish_reason: 'stop' }
    }

    // Swap LLM on the engine (accessing private field for test purposes)
    ;(engine as unknown as { llm: unknown }).llm = secondLlm
    const { handler: handler2 } = collectEvents()

    const result2 = await engine.sendMessage('What spells can it cast at level 3?', handler2)

    expect(result2.toolResults).toHaveLength(1)
    expect(result2.text).toContain('Fireball')

    // Verify history contains both conversations
    const history = engine.getHistory()
    const userMessages = history.filter(m => m.role === 'user')
    expect(userMessages).toHaveLength(2)
    expect(userMessages[0]!.content).toContain('wizard')
    expect(userMessages[1]!.content).toContain('spells')
  })

  it('conversation history grows across multiple turns', async () => {
    const spec = await loadSpec('dnd5e')
    const executor = createDndExecutor()

    // Use a simple LLM that always calls get_api then responds
    let turnCount = 0
    const multiTurnLlm = async (_messages: unknown[], _tools: unknown[], onToken: (t: string) => void) => {
      turnCount++
      if (turnCount % 2 === 1) {
        return {
          content: '',
          tool_calls: [{
            id: `call_turn_${turnCount}`,
            type: 'function' as const,
            function: { name: 'get_api', arguments: '{}' },
          }],
          finish_reason: 'tool_calls',
        }
      }
      onToken(`Response for turn ${Math.ceil(turnCount / 2)}.`)
      return { content: `Response for turn ${Math.ceil(turnCount / 2)}.`, tool_calls: [], finish_reason: 'stop' }
    }

    const engine = buildTestEngine(spec, multiTurnLlm as never, executor)

    // Send 3 messages
    await engine.sendMessage('First question', () => {})
    await engine.sendMessage('Second question', () => {})
    await engine.sendMessage('Third question', () => {})

    const history = engine.getHistory()
    const userMessages = history.filter(m => m.role === 'user')
    expect(userMessages).toHaveLength(3)
    expect(userMessages[0]!.content).toBe('First question')
    expect(userMessages[1]!.content).toBe('Second question')
    expect(userMessages[2]!.content).toBe('Third question')
  })
})

// ── Edge cases ──

describe('Edge cases', () => {
  it('maxRounds forces text response after limit', async () => {
    const spec = await loadSpec('dnd5e')
    // LLM always wants to call tools
    const llm = createScriptedLlm([
      { toolCalls: [{ name: 'get_api', args: {} }] },
      { toolCalls: [{ name: 'get_api_endpoint', args: { endpoint: 'classes' } }] },
      // Round 3: engine sends no tools, so this should be text
      { text: 'Here is everything I found.' },
    ])
    const engine = buildTestEngine(spec, llm, createDndExecutor(), { maxRounds: 2 })
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('Explore everything', handler)

    // Should have 2 tool results (maxRounds=2)
    expect(result.toolResults).toHaveLength(2)
    expect(result.text).toBe('Here is everything I found.')
  })

  it('error in first tool, recovery with second tool', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'nonexistent' } }] },
      { toolCalls: [{ name: 'get_api_endpoint', args: { endpoint: 'classes' } }] },
      { text: 'Found 12 classes after correcting the query.' },
    ])
    const engine = buildTestEngine(spec, llm, createDndExecutor())
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('Show me classes', handler)

    const errors = events.filter(e => e.type === ChatEventType.ToolCallError)
    const successes = events.filter(e => e.type === ChatEventType.ToolCallResult)
    expect(errors).toHaveLength(1)
    expect(successes).toHaveLength(1)
    expect(result.text).toContain('12 classes')
  })
})
