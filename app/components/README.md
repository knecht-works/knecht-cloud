# Component naming

Files directly in `app/components/` get a `K` prefix (`KPanel.vue`, `KStatusDot.vue`) to mark them as this app's own components, distinct from `@nuxt/ui`'s.

Files in a subfolder (e.g. `workflow/`) don't need a prefix: Nuxt's path-based auto-import already prefixes them by folder name (`workflow/StepCard.vue` → `<WorkflowStepCard>`).
