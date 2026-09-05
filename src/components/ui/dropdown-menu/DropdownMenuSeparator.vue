<script setup lang="ts">
import { DropdownMenuSeparator } from 'reka-ui';
import { cn } from '../../../lib/utils';

interface Props {
  class?: string;
}

const props = withDefaults(defineProps<Props>(), { class: undefined });
</script>

<template>
  <DropdownMenuSeparator :class="cn('-mx-1 my-1 h-px bg-border', props.class)" />
</template>
