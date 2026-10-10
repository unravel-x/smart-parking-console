<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatTime } from '../domain/parking'
import { useParkingStore } from '../stores/parking'

const store = useParkingStore()
const query = ref('')
const direction = ref('all')
const page = ref(1)
const pageSize = 10
const filtered = computed(() => store.events.filter(e => e.plateNo.includes(query.value.trim().toUpperCase()) && (direction.value === 'all' || e.direction === direction.value)))
const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
</script>

<template>
  <div class="page-head"><div><span class="eyebrow">ACCESS EVENTS</span><h1>进出记录</h1><p>每次入口和出口触发形成独立事件，可关联停车会话。</p></div><span class="head-status">共 {{ store.events.length }} 条事件</span></div>
  <section class="surface-card table-card"><div class="table-toolbar"><div><el-input v-model="query" clearable placeholder="搜索车牌号码" @input="page = 1" /><el-select v-model="direction" @change="page = 1"><el-option label="全部方向" value="all" /><el-option label="入场" value="entry" /><el-option label="出场" value="exit" /></el-select></div></div><el-table :data="rows" stripe empty-text="暂无进出记录"><el-table-column label="事件编号" prop="eventId" min-width="145" /><el-table-column label="方向" min-width="90"><template #default="scope"><span class="status-tag" :class="scope.row.direction === 'entry' ? 'success' : 'info'">{{ scope.row.direction === 'entry' ? '入场' : '出场' }}</span></template></el-table-column><el-table-column label="车牌号码" prop="plateNo" sortable min-width="135"><template #default="scope"><strong class="plate-text">{{ scope.row.plateNo }}</strong></template></el-table-column><el-table-column label="车道编号" prop="laneId" min-width="110" /><el-table-column label="抓拍时间" prop="capturedAt" sortable min-width="190"><template #default="scope">{{ formatTime(scope.row.capturedAt) }}</template></el-table-column><el-table-column label="识别来源" min-width="110"><template #default="scope">{{ scope.row.recognitionSource === 'demo' ? '模拟识别' : scope.row.recognitionSource === 'api' ? '识别接口' : scope.row.recognitionSource === 'ftp' ? 'FTP 车牌' : '人工录入' }}</template></el-table-column><el-table-column label="会话编号" min-width="150"><template #default="scope">{{ scope.row.sessionId || '待人工处理' }}</template></el-table-column></el-table><div class="table-pagination"><span>共 {{ filtered.length }} 条</span><el-pagination v-model:current-page="page" :page-size="pageSize" layout="prev, pager, next" :total="filtered.length" /></div></section>
</template>
