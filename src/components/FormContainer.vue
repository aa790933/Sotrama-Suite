<template>
  <div
    class="flex bg-background overflow-x-auto custom-scroll custom-scroll-thumb1"
  >
    <div class="flex flex-1 flex-col">
      <!-- Page Header (Title, Buttons, etc) -->
      <PageHeader
        v-if="showHeader"
        :title="title"
        :border="false"
        :searchborder="searchborder"
      >
        <template #left>
          <slot name="header-left" />
        </template>
        <slot name="header" />
      </PageHeader>

      <!-- Common Form -->
      <div
        class="flex flex-col self-center h-full overflow-auto bg-card text-card-foreground"
        :class="
          useFullWidth
            ? 'w-full border-t border-border'
            : 'w-full max-w-6xl border border-border rounded-xl shadow-lg mb-6 mx-4 p-6'
        "
      >
        <slot name="body" />
      </div>
    </div>

    <!-- Invoice Quick Edit -->
    <slot name="quickedit" />
  </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import PageHeader from './PageHeader.vue';

export default defineComponent({
  components: { PageHeader },
  props: {
    title: { type: String, default: '' },
    useFullWidth: { type: Boolean, default: false },
    showHeader: { type: Boolean, default: true },
    searchborder: { type: Boolean, default: true },
  },
});
</script>
