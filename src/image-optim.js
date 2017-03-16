import AWS from 'aws-sdk';
import imagemin from 'imagemin';
import optipng from 'imagemin-optipng';
import imageminGifsicle from 'imagemin-gifsicle';
import imageminMozjpeg from 'imagemin-mozjpeg';
import imageminPngquant from 'imagemin-pngquant';
import imageminSvgo from 'imagemin-svgo';
import imageminWebp from 'imagemin-webp';
import async from 'async';


const s3 = new AWS.S3();

const acl = process.env.UPLOAD_ACL || 'public-read';
const uploadBucket = process.env.UPLOAD_BUCKET;
const pngLevel = +process.env.PNG_OPTIM_LEVEL || 7;
const skipSize = +process.env.MAX_FILE_SIZE || -1;


const doOptimizeFile = (s3file, callback) => {
  const { bucket, key } = s3file;
  console.log(`IMAGE OPTIM: ${bucket} ${key}`);
  if (!/\.(jpe?g|png|gif|svg|webp)$/.test(key)) {
    const err = new Error('Not a supported image type');
    return callback(err);
  }
  async.waterfall([
    cb => {
      s3.headObject({ Bucket: bucket, Key: key }, (err, data) => {
        if (err) return cb(err);

        if (data.Metadata && data.Metadata.optimized) {
          console.log('Image is already optimized. Skipping.');
          return cb('skip');
        }

        if (data.ContentLength) {
          // console.log('File size is ' + data.ContentLength + ' bytes');

          if (skipSize !== -1 && data.ContentLength > skipSize) {
            console.log('Image is larger than configured threshold. Skipping.');
            return cb('skip');
          }
        }

        return cb(null, data);
      });
    },

    (meta, cb) => {
      s3.getObject({ Bucket: bucket, Key: key }, (err, data) => {
        if (err) return cb(err);
        return cb(null, meta, data);
      });
    },

    (meta, obj, cb) => {
      // console.log('Optimizing!');
      // console.log(obj.Body);
      imagemin.buffer(obj.Body, {
        plugins: [
          imageminGifsicle(),
          imageminMozjpeg(),
          imageminPngquant({ quality: '65-80' }),
          imageminSvgo({ plugins: [{ removeViewBox: false }] }),
          imageminWebp({ quality: 50 }),
        ],
      }).then(buf => {
        // console.log(buf);
        // console.log('Optimized! Final file size is ' + buf.length + ' bytes');
        cb(null, meta, obj, buf);
      }).catch(err => {
        console.log('imagemin error thrown!');
        console.log(err.message || err.reason || '?');
        return cb(err);
      });
    },

    (meta, obj, buf, cb) => {
      const sizeInit = meta.data.ContentLength;
      const sizeEnd = buf.length;
      const sizeTrimmedPercent = Math.round(1000 * ((sizeInit - sizeEnd) / sizeInit)) / 10;

      meta.Metadata.sizeTrimmedPercent = sizeTrimmedPercent;
      meta.Metadata.optimized = 'yes';

      s3.putObject({
        ACL: acl,
        Bucket: uploadBucket || bucket,
        Key: key,
        Body: buf,
        ContentType: obj.ContentType,
        Metadata: meta.Metadata,
      }, err => {
        if (err) return cb(err);
        console.log(
          `Optimized & Saved!
          ${sizeInit} --> ${sizeEnd} bytes
          (Reduced ${sizeTrimmedPercent}%)
        `);
        return cb();
      });
    },
  ], err => {
    if (err && err === 'skip') {
      return callback(null, 'skipped');
    }
    if (err) {
      return callback(err, 'errored');
    }
    return callback(null, 'success');
  });
  return '';
};

export default doOptimizeFile;

