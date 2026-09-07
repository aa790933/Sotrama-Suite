<template>
  <div>
    <div v-if="showLabel" :class="labelClasses">
      {{ df.label }}
    </div>
    <div :class="showMandatory ? 'show-mandatory' : ''">
      <UiTextarea
        ref="input"
        :rows="df.rows ?? rows"
        :class="['resize-none bg-transparent', inputClasses, containerClasses]"
        :model-value="inputModelValue"
        :placeholder="inputPlaceholder"
        style="vertical-align: top"
        :readonly="isReadOnly"
        :tabindex="isReadOnly ? '-1' : '0'"
        @blur="(e) => triggerChange(e.target.value)"
        @focus="(e) => $emit('focus', e)"
        @input="(e) => $emit('input', e)"
      />
    </div>
  </div>
</template>

<script>
import UiTextarea from '../ui/textarea/Textarea.vue';
import Base from './Base.vue';

export default {
  name: 'Text',
  components: { UiTextarea },
  extends: Base,
  props: { rows: { type: Number, default: 3 } },
  emits: ['focus', 'input'],
};
</script>
