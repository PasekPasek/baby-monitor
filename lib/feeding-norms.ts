/**
 * AAP/WHO feeding norms by baby age.
 * Used by telegram route for cluster-aware feeding confirmations and query agent.
 */

export type FeedingNorms = {
  minMlPerCluster: number
  maxMlPerCluster: number
  feedsPerDay: { min: number; max: number }
  dailyMlPerKg: { min: number; max: number }
  clusterWindowHours: number
  notes: string
}

export function getFeedingNorms(ageWeeks: number): FeedingNorms {
  if (ageWeeks < 2) {
    return {
      minMlPerCluster: 30,
      maxMlPerCluster: 90,
      feedsPerDay: { min: 8, max: 12 },
      dailyMlPerKg: { min: 150, max: 200 },
      clusterWindowHours: 3,
      notes: "Pierwsze 2 tyg — małe, częste karmienia, żołądek wielkości orzecha. Cluster feeding w 3h to jeden posiłek.",
    }
  }
  if (ageWeeks < 6) {
    return {
      minMlPerCluster: 60,
      maxMlPerCluster: 120,
      feedsPerDay: { min: 6, max: 10 },
      dailyMlPerKg: { min: 150, max: 200 },
      clusterWindowHours: 3,
      notes: "2-6 tyg — wzrasta pojemność żołądka, cluster feeding (kilka karmień w 3h) jest normalny.",
    }
  }
  if (ageWeeks < 12) {
    return {
      minMlPerCluster: 120,
      maxMlPerCluster: 180,
      feedsPerDay: { min: 6, max: 8 },
      dailyMlPerKg: { min: 150, max: 200 },
      clusterWindowHours: 3,
      notes: "6-12 tyg — dłuższe przerwy, większe porcje per klaster.",
    }
  }
  return {
    minMlPerCluster: 150,
    maxMlPerCluster: 210,
    feedsPerDay: { min: 5, max: 7 },
    dailyMlPerKg: { min: 150, max: 200 },
    clusterWindowHours: 3,
    notes: "3+ mies. — regularniejszy rytm karmienia.",
  }
}
