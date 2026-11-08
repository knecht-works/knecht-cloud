export function useToastError() {
  const toast = useToast()
  return (title: string, e: unknown) => {
    toast.add({ title, description: errMsg(e, ''), color: 'error' })
  }
}
