<script setup lang="ts">
import { cn } from '../../../lib/utils';
import { badgeVariants, type BadgeVariants } from './variants';

interface Props {
  variant?: BadgeVariants['variant'];
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  class: undefined,
});
</script>

<template>
  <span :class="cn(badgeVariants({ variant: props.variant }), props.class)">
    <slot />
  </span>
</template>
