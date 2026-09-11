// Every route requires a session except these; mirror of server/middleware/auth.ts.
const PUBLIC_ROUTES = ['/login', '/setup']

export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  const isPublic = PUBLIC_ROUTES.includes(to.path)

  if (!loggedIn.value && !isPublic) {
    return navigateTo('/login')
  }
  if (loggedIn.value && isPublic) {
    return navigateTo('/')
  }
})
