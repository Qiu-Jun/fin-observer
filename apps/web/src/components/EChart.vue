<template>
  <div ref="el" :style="{ height: height ?? '320px', width: '100%' }" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';

const props = defineProps<{ option: Record<string, unknown>; height?: string }>();
const el = ref<HTMLDivElement>();
let chart: echarts.ECharts | undefined;

const render = () => {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value);
  chart.setOption(props.option as echarts.EChartsOption, true);
};
const resize = () => chart?.resize();

onMounted(() => {
  render();
  window.addEventListener('resize', resize);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  chart?.dispose();
  chart = undefined;
});
watch(() => props.option, render, { deep: true });
</script>
