<script setup lang="ts">
import { DialogRoot } from 'reka-ui';

interface Props {
  open?: boolean;
}

withDefaults(defineProps<Props>(), { open: undefined });

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <slot />
  </DialogRoot>
</template>
