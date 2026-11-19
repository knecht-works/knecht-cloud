import { useToast } from '#imports'
import { errMsg } from '~/utils/dashboard'

export function useToastError() {
  const toast = useToast()
  return (title: string, e: unknown) => {
    toast.add({ title, description: errMsg(e, ''), color: 'error' })
  }
}
