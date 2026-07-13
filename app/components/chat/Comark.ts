// The follow-up chat's markdown renderer for agent replies: prose components
// with syntax-highlighted code blocks, margins trimmed to fit a chat bubble.
export default defineComarkComponent({
  name: 'ChatComark',
  class: 'text-2sm *:first:mt-0 *:last:mb-0',
})
