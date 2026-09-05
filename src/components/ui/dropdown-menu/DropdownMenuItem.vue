<script setup lang="ts">
import { DropdownMenuItem } from 'reka-ui';
import { cn } from '../../../lib/utils';

interface Props {
  disabled?: boolean;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  class: undefined,
});

const emit = defineEmits<{
  (e: 'select', event: Event): void;
}>();
</script>

<template>
  <DropdownMenuItem
    :disabled="props.disabled"
    :class="
      cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
        props.class
      )
    "
    @select="emit('select', $event)"
  >
    <slot />
  </DropdownMenuItem>
</template>
