interface IVersions {
  [platform: string]: {
    defaultVersion: string;
    allVersions: string[];
  };
}
const versions: IVersions = {
  dotnet: {
    defaultVersion: '6.0',
    allVersions: [
      '2.1',
      '2.2',
      '3.0',
      '3.1',
      '5.0',
      '6.0',
      '7.0',
      '8.0',
      '9.0',
    ],
  },
  node: { defaultVersion: '20', allVersions: ['14', '16', '18', '20', '22'] },
  next: { defaultVersion: '20', allVersions: ['20', '22'] },
  laravel: {
    defaultVersion: '8.0',
    allVersions: [
      '8.3.0',
      '8.2.0',
      '8.1.0',
      '8.0.0',
      '7.4.0',
      '7.3.0',
      '7.2.0',
    ],
  },
  php: {
    defaultVersion: '8.0',
    allVersions: [
      '8.3.0',
      '8.2.0',
      '8.1.0',
      '8.0.0',
      '7.4.0',
      '7.3.0',
      '7.2.0',
    ],
  },
  python: {
    defaultVersion: '3.11',
    allVersions: ['3.7', '3.8', '3.9', '3.10', '3.11', '3.12'],
  },
  django: {
    defaultVersion: '3.10',
    allVersions: ['3.7', '3.8', '3.9', '3.10', '3.11', '3.12'],
  },
  flask: {
    defaultVersion: '3.10',
    allVersions: ['3.7', '3.8', '3.9', '3.10', '3.11', '3.12'],
  },
};
// export const defaultVersion={

// }

export default function supportedVersions(platform: string) {
  if (platform in versions) {
    return versions[platform as keyof typeof versions];
  }
  return null;
}
