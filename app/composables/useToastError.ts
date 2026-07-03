// The one shape almost every failed mutation reports: an error toast with the
// H3 statusMessage as detail. Grab it in setup (`const toastError =
// useToastError()`), call it in the catch (`toastError('Failed to save', e)`).
export function useToastError() {
  const toast = useToast()
  return (title: string, e: unknown) => {
    toast.add({ title, description: errMsg(e, ''), color: 'error' })
  }
}
