declare module 'ae-cvss-calculator' {
  export interface CVSSScores {
    base: number;
    temporal?: number;
    environmental?: number;
    overall?: number;
    vector: string;
  }

  export interface CVSSCalculator {
    calculateScores(): CVSSScores;
  }

  export class Cvss2 implements CVSSCalculator {
    constructor(vector: string);
    calculateScores(): CVSSScores;
  }

  export class Cvss3P0 implements CVSSCalculator {
    constructor(vector: string);
    calculateScores(): CVSSScores;
  }

  export class Cvss3P1 implements CVSSCalculator {
    constructor(vector: string);
    calculateScores(): CVSSScores;
  }

  export class Cvss4P0 implements CVSSCalculator {
    constructor(vector: string);
    calculateScores(): CVSSScores;
  }

  const cvssLib: {
    Cvss2: typeof Cvss2;
    Cvss3P0: typeof Cvss3P0;
    Cvss3P1: typeof Cvss3P1;
    Cvss4P0: typeof Cvss4P0;
  };

  export default cvssLib;
}
