import AWS from 'aws-sdk';
import imagemin from 'imagemin';
import optipng from 'imagemin-optipng';
import imageminGifsicle from 'imagemin-gifsicle';
import imageminGuetzli from 'imagemin-guetzli'
import imageminMozjpeg from 'imagemin-mozjpeg'
import imageminPngquant from 'imagemin-pngquant';
import imageminSvgo from 'imagemin-svgo';
import imageminWebp from 'imagemin-webp';
import Async from 'async';
import fileType from 'file-type';
import gm from 'gm';

const s3 = new AWS.S3();
const im = gm.subClass({ imageMagick: true });

const acl = process.env.UPLOAD_ACL || 'public-read';
const uploadBucket = process.env.UPLOAD_BUCKET;
const pngLevel = +process.env.PNG_OPTIM_LEVEL || 7;
const skipSize = +process.env.MAX_FILE_SIZE || -1;


export const getHeadAndMaybeSkip = (params, cb) => {
  s3.headObject(params, (err, head) => {
    if (err) return cb(err);

    if (head.Metadata && head.Metadata.optimized) {
      console.log('Image is already optimized. Skipping.');
      return cb('skip');
    }

    if (head.ContentLength) {
      // console.log('File size is ' + head.ContentLength + ' bytes');

      if (skipSize !== -1 && head.ContentLength > skipSize) {
        console.log('Image is larger than configured threshold. Skipping.');
        return cb('skip');
      }
    }

    return cb(null, params, head);
  });
};
export const getObject = (params, head, cb) => {
  s3.getObject(params, (err, data) => {
    if (err) return cb(err);
    return cb(null, params, head, data);
  });
};
export const correctFileType = (params, head, obj, cb) => {
  try {
    let hasCalledBack = false;
    const fileTypeFromKey = params.Key.split('.').pop();
    const fileTypeFromMagicNumber = fileType(obj.Body);
    console.log(`file: ${params.Key}`);
    console.log(`fileTypeFromKey: ${fileTypeFromKey}`);
    console.log(`fileTypeFromMagicNumber: ${fileTypeFromMagicNumber.ext}`);
    // convert image: actual file type and file extension from key don't match
    if (fileTypeFromKey !== fileTypeFromMagicNumber.ext) {
      hasCalledBack = true;
      console.log(`Converting file type ${fileTypeFromMagicNumber.ext} to ${fileTypeFromKey}`);
      im(obj.Body).toBuffer(fileTypeFromKey, (err, buffer) => {
        if (err) {
          console.log(err);
        } else {
          console.log(`File type in IM buffer: ${JSON.stringify(fileType(buffer))}`);
          head.Metadata.originalFileType = fileTypeFromMagicNumber.ext;
          return cb(null, params, head, obj, buffer);
        }
      });
    }
    if (!hasCalledBack) {
      return cb(null, params, head, obj, obj.Body);
    }
  } catch (e) {
    console.log(`correctFileType Error: ${e}`);
    console.log('Error correcting file type. Skipping.');
    return (cb('skip'));
  }
}
export const runImageMin = (params, head, obj, buffer, cb) => {
  // console.log('Optimizing!');
  // console.log(obj.Body);
  const fileType = params.Key.split('.').pop();
  const plugins = [];
  console.log(`File type: ${fileType}`);
  switch (fileType) {
    case 'gif':
      plugins.push(imageminGifsicle());
      break;
    case 'jpeg':
    case 'jpg':
      plugins.push(imageminGuetzli());
      plugins.push(imageminMozjpeg({quality: '95'}));
      break;
    case 'png':
      plugins.push(imageminPngquant());
      break;
    case 'svg':
      plugins.push(imageminSvgo());
      break;
    case 'webp':
      plugins.push(imageminWebp());
      break;
    default:
      console.log('Incompatible file type. Skipping.');
      return (cb('skip'));
  }
  imagemin.buffer(buffer, {
    plugins,
  }).then(buf => {
    // console.log(buf);
    // console.log('Optimized! Final file size is ' + buf.length + ' bytes');
    cb(null, params, head, obj, buf);
  }).catch(err => {
    console.log('imagemin error thrown!');
    console.log(err.message || err.reason || '?');
    return cb(err);
  });
};
export const uploadMinifiedFile = (params, head, obj, buf, cb) => {
  const sizeInit = head.ContentLength;
  const sizeEnd = buf.length;
  const sizeTrimmedPercent = Math.round(1000 * ((sizeInit - sizeEnd) / sizeInit)) / 10;

  // modify metadata (from initial head request)
  head.Metadata.sizeTrimmedPercent = String(sizeTrimmedPercent);
  head.Metadata.optimized = 'yes';

  s3.putObject({
    ACL: acl,
    Bucket: params.Bucket,
    Key: params.Key,
    Body: buf,
    ContentType: obj.ContentType,
    Metadata: head.Metadata,
  }, err => {
    if (err) return cb(err);
    return cb(null, { sizeInit, sizeEnd, sizeTrimmedPercent });
  });
};


const doOptimizeFile = (s3file, callback) => {
  const { bucket, key } = s3file;
  console.log(`IMAGE OPTIM: ${bucket} ${key}`);
  if (!/\.(jpe?g|png|gif|svg|webp)$/.test(key)) {
    const err = new Error('Not a supported image type');
    return callback(err);
  }
  const params = { Bucket: bucket, Key: key };
  Async.waterfall([
    (cb) => (cb(null, params)),
    getHeadAndMaybeSkip,
    getObject,
    correctFileType,
    runImageMin,
    uploadMinifiedFile,
  ], (err, out) => {
    if (err && err === 'skip') {
      return callback(null, 'skipped');
    }
    if (err) {
      return callback(err, 'errored');
    }
    const { sizeInit, sizeEnd, sizeTrimmedPercent } = out;
    console.log(
      `Optimized & Saved!
          ${sizeInit} --> ${sizeEnd} bytes
          (Reduced ${sizeTrimmedPercent}%)
        `);
    return callback(null, 'success');
  });
  return '';
};

export default doOptimizeFile;

