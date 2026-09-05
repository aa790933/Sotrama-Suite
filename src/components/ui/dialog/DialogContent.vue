<script setup lang="ts">
import { X } from '@lucide/vue';
import { DialogClose, DialogContent, DialogOverlay, DialogPortal } from 'reka-ui';
import { cn } from '../../../lib/utils';

interface Props {
  class?: string;
}

const props = withDefaults(defineProps<Props>(), { class: undefined });

const emit = defineEmits<{
  (e: 'close'): void;
}>();
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-50 bg-black/50 animate-fade-in data-[state=closed]:animate-fade-out"
    />
    <DialogContent
      :class="
        cn(
          'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border border-border bg-background p-6 shadow-lg rounded-lg animate-zoom-in data-[state=closed]:animate-zoom-out',
          props.class
        )
      "
      @escape-key-down="emit('close')"
      @pointer-down-outside="emit('close')"
    >
      <slot />
      <DialogClose
        class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
        @click="emit('close')"
      >
        <X class="h-4 w-4" />
        <span class="sr-only">Close</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
