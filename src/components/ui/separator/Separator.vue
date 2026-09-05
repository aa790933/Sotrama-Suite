<script setup lang="ts">
import { cn } from '../../../lib/utils';

interface Props {
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  orientation: 'horizontal',
  decorative: true,
  class: undefined,
});
</script>

<template>
  <div
    role="separator"
    :aria-orientation="props.orientation"
    :class="
      cn(
        'shrink-0 bg-border',
        props.orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        props.class
      )
    "
  />
</template>
