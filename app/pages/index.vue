<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Dashboard">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <p class="mb-6 text-sm text-muted">
        Walking skeleton — UI → Daemon → ddev / Docker
      </p>
      <SystemPanel />
    </template>
  </UDashboardPanel>
</template>
