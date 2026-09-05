<script setup lang="ts">
import { cn } from '../../../lib/utils';

interface Props {
  class?: string;
}

const props = withDefaults(defineProps<Props>(), { class: undefined });
</script>

<template>
  <tr
    :class="
      cn(
        'border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        props.class
      )
    "
  >
    <slot />
  </tr>
</template>
