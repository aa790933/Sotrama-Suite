<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { ref } from "vue"
import { cn } from 'src/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes["class"]
  defaultValue?: string | number
  modelValue?: string | number
}>()

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})

const textareaRef = ref<HTMLTextAreaElement | null>(null)

// Focus contract for Options-API control adapters (see Input.vue).
defineExpose({
  focus: (options?: FocusOptions) => textareaRef.value?.focus(options),
  select: () => textareaRef.value?.select(),
  blur: () => textareaRef.value?.blur(),
})
</script>

<template>
  <textarea ref="textareaRef" v-model="modelValue" :class="cn('flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', props.class)" />
</template>
