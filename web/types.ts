export type MaterialRow = {
  name: string;
  triangles: number;
  alpha: number;
  doubleSided: boolean;
  transparent: boolean;
};

export type Session = {
  id: string;
  name: string;
  profile: any;
  materials: MaterialRow[];
  warnings: string[];
};

export type Result = {
  id: string;
  report: any;
  details: any;
  excluded: string[];
  conversionMs?: number;
  cached?: boolean;
  settings?: any;
};
