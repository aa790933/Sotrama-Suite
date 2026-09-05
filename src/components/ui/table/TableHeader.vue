<script setup lang="ts">
import { cn } from '../../../lib/utils';

interface Props {
  class?: string;
}

const props = withDefaults(defineProps<Props>(), { class: undefined });
</script>

<template>
  <thead :class="cn('[&_tr]:border-b', props.class)">
    <slot />
  </thead>
</template>
