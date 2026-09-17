import { deletePlaneConnection, planeConnectionStatus } from '../../integrations/plane/credentials'

export default defineEventHandler(() => {
  deletePlaneConnection()
  return planeConnectionStatus()
})
