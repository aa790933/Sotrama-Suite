<template>
  <div class="flex">
    <SearchBar />
    <!-- Back Button -->
    <button
      ref="backlink"
      type="button"
      :aria-label="t`Go back`"
      :title="t`Go back`"
      :disabled="!historyState.back"
      class="nav-link border-s border-e border-border disabled:cursor-not-allowed disabled:opacity-60"
      :class="
        historyState.back
          ? 'text-foreground cursor-pointer'
          : 'text-muted-foreground'
      "
      @click="$router.back()"
    >
      <feather-icon name="chevron-left" class="w-4 h-4" />
    </button>
    <!-- Forward Button -->
    <button
      type="button"
      :aria-label="t`Go forward`"
      :title="t`Go forward`"
      :disabled="!historyState.forward"
      class="nav-link rounded-md rounded-s-none"
      :class="
        historyState.forward
          ? 'text-foreground cursor-pointer'
          : 'text-muted-foreground'
      "
      @click="$router.forward()"
    >
      <feather-icon name="chevron-right" class="w-4 h-4" />
    </button>
  </div>
</template>
<script lang="ts">
import { shortcutsKey } from 'src/utils/injectionKeys';
import { ref, inject } from 'vue';
import { defineComponent } from 'vue';
import SearchBar from './SearchBar.vue';
import { historyState } from 'src/utils/refs';

const COMPONENT_NAME = 'PageHeaderNavGroup';

export default defineComponent({
  components: { SearchBar },
  setup() {
    return {
      historyState,
      backlink: ref<HTMLButtonElement | null>(null),
      shortcuts: inject(shortcutsKey),
    };
  },
  computed: {
    hasBack() {
      return !!history.back;
    },
    hasForward() {
      return !!history.forward;
    },
  },
  activated() {
    this.shortcuts?.shift.set(COMPONENT_NAME, ['Backspace'], () => {
      this.backlink?.click();
    });
    // @ts-ignore
    window.ng = this;
  },
  deactivated() {
    this.shortcuts?.delete(COMPONENT_NAME);
  },
});
</script>

<style scoped>
.nav-link {
  @apply flex items-center justify-center bg-muted px-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2;
}
</style>
