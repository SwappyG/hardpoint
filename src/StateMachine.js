const _pretty = (o, replacer) => JSON.stringify(o, replacer ?? null, 4)
const replacer = (key, value) => {
  return !(value instanceof Map) ? value : Array.from(value.entries())
}

const print_transition_table = (t) => {
  let out = {}
  for (const [state, transitions] of t) {
    out[state] = []
    for (const [event, new_state] of transitions) {
      out[state].push(` + ${event} -> ${new_state}`)
    }
  }
  return _pretty(out)
}


class StateMachine {
  constructor({ name, transition_table, initial_state, initial_data, loop_period }) {
    this.name = name
    this.transition_table = transition_table
    this.current_state = initial_state
    this.events = new Array()
    this.data = initial_data
    this.timeout_obj = setInterval(this.loop, loop_period)

    console.log(
      `Created a state machine [${_pretty(this.name)}]\n` +
      `Initial State: ${_pretty(this.current_state)}\n` +
      `Transition Table:\n\n${print_transition_table(this.transition_table)}\n\n` +
      `Initial Data:\n\n${_pretty(this.data)}\n`
    )
  }

  stop = () => {
    console.log(`stopping the state machine [${this.name}]`)
    clearInterval(this.timeout_obj)
  }

  push_event = (event, action, on_success, on_failure) => {
    this.events.push({
      'event': event,
      'action': action,
      'on_success': on_success,
      'on_failure': on_failure
    })
  }

  set_data = (keys, value) => {
    // if keys is null, then assume value should overwrite all this.data
    if (keys === null) {
      this.data = value
      return
    }

    // if keys is a single key, then value should overwrite this.data[keys] 
    if (typeof keys === 'string') {
      this.data[keys] = value
      return
    }

    // if keys is an array, then value should overwrite this.data[keys[0]][keys[1]]...
    if (Array.isArray(keys)) {
      keys.reduce((memo, arg, index) => {
        if (index === keys.length - 1) {
          memo[arg] = value
        }
        return memo[arg]
      }, this.data)
    }
  }

  get_data = () => {
    return this.data
  }

  loop = () => {
    const events_copy = [...this.events]
    this.events = []
    events_copy.forEach(({ event, action, on_success, on_failure }) => {
      console.log(`processing event [${event}] in state [${this.current_state}]`)
      if (!this.transition_table.get(this.current_state).has(event)) {
        console.log(`transition table doesn't have [${this.current_state}] + [${event}]`)
        if (on_failure !== undefined) {
          on_failure()
        }
        return
      }

      console.log(`calling action for event [${event}]`)
      const do_transition = action(
        this.data,
        this.set_data,
        this.get_data
      )

      console.log(`action called for event [${event}], result [${do_transition}]`)
      if (!do_transition) {
        if (on_failure !== undefined) {
          on_failure()
        }
        return
      }

      const prev_state = this.current_state
      const next_state = this.transition_table.get(this.current_state).get(event)
      this.current_state = next_state
      if (on_success !== undefined) {
        console.log(`calling on_success follow up function`)
        on_success(this.data, this.set_data, this.get_data)
      }

      console.log(`transitioning [${prev_state}] + [${event}] --> [${next_state}]`)
    })
  }
}


export {
  StateMachine
}

