// One action at a time on a page: which one is running, and the message of the last failure.
// busy is the name of the running action, '' when idle. Bind it to :disabled and to the button label
export function useAction() {
  const busy = ref('')
  const error = ref('')

  async function run<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (busy.value) return
    error.value = ''
    busy.value = name
    try {
      return await fn()
    }
    catch (err) {
      error.value = errorMessage(err)
    }
    finally {
      busy.value = ''
    }
  }

  return { busy, error, run }
}
