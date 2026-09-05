<script setup lang="ts">
import { DropdownMenuLabel } from 'reka-ui';
import { cn } from '../../../lib/utils';

interface Props {
  class?: string;
}

const props = withDefaults(defineProps<Props>(), { class: undefined });
</script>

<template>
  <DropdownMenuLabel :class="cn('px-2 py-1.5 text-sm font-semibold', props.class)">
    <slot />
  </DropdownMenuLabel>
</template>
