// #41 单14.4：PK10 赛车图资产（car_0X = 车号 X）——纯资产模块（无组件），
// GoldenBootMarkets(CarImgBead) 与 GoldenBoot(舞台赛道渲染) 共用，single source。
import car01 from '../../assets/goldenboot/car_01.png'
import car02 from '../../assets/goldenboot/car_02.png'
import car03 from '../../assets/goldenboot/car_03.png'
import car04 from '../../assets/goldenboot/car_04.png'
import car05 from '../../assets/goldenboot/car_05.png'
import car06 from '../../assets/goldenboot/car_06.png'
import car07 from '../../assets/goldenboot/car_07.png'
import car08 from '../../assets/goldenboot/car_08.png'
import car09 from '../../assets/goldenboot/car_09.png'
import car10 from '../../assets/goldenboot/car_10.png'

export const CAR_SRC = { 1: car01, 2: car02, 3: car03, 4: car04, 5: car05, 6: car06, 7: car07, 8: car08, 9: car09, 10: car10 }

// #Ray 极速方格顶栏冠军车：按【队色】选车（非 %10 取余）。逐台主色实测挑贴色四台：
//   蓝队 car_09 深蓝(32,64,160) / 红队 car_05 纯红(224,32,32) / 金队 car_06 黄金(224,192,32) /
//   黑队 —— 十台无纯黑车，照 PK10 黑队成例（SpeedGridStage：绿车 car_07 压暗滤镜代黑涂装）。
//   TEAM_CAR 下标 = 队序（0 蓝 / 1 红 / 2 金 / 3 黑），与 speedgridTeams.TEAMS 同序。
export const TEAM_CAR = [
  { src: car09, filter: 'none' },
  { src: car05, filter: 'none' },
  { src: car06, filter: 'none' },
  { src: car07, filter: 'brightness(0.4) saturate(0.55)' },   // 绿车压暗代黑（PK10 成例）
]
// 冠军号 → 队序 → 车（禁 %10 取余）
export const teamCarOf = (champ) => TEAM_CAR[Math.floor((champ - 1) / 6)] || null
